import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { MAIN_WORKTREE_ID, WORKTREE_NAME_RE, normalizeWorktreeId } from "~/shared/worktrees";
import type { WorktreeInfo, WorktreeTaskCounts } from "~/shared/worktrees";
import { TASK_STATUSES } from "~/shared/domain";
import { findProjectById } from "../repositories/projects.repo";
import {
  deleteWorktreeRow,
  findWorktreeById,
  findWorktreeByProjectAndName,
  findWorktreesByProjectId,
  insertWorktree,
} from "../repositories/worktrees.repo";
import { findTasksByProjectIdAllScopes } from "../repositories/tasks.repo";
import { newId } from "./_ids";
import { events } from "../events";

const GIT_WORKTREE_TIMEOUT_MS = 30_000;
// Windows keeps a file locked for a short window after the process holding it
// exits. `fs.rm` retries on EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM, which covers
// the lag between killing a worktree's terminals/agents and the OS releasing
// their handles (commonly on `.claude/`). ~1s of total backoff at 100ms steps.
const WORKTREE_RM_MAX_RETRIES = 10;
const WORKTREE_RM_RETRY_DELAY_MS = 100;
const NAME_PARTS = [
  "amber",
  "arctic",
  "autumn",
  "bright",
  "cedar",
  "cinder",
  "cosmic",
  "crystal",
  "delta",
  "ember",
  "forest",
  "frost",
  "golden",
  "harbor",
  "hidden",
  "lunar",
  "meadow",
  "meteor",
  "neon",
  "ocean",
  "orbit",
  "polar",
  "prairie",
  "quiet",
  "river",
  "rocket",
  "shadow",
  "solar",
  "summit",
  "violet",
  "willow",
  "zephyr",
];

type RunResult = { stdout: string; stderr: string; code: number };

export class WorktreeDirtyError extends Error {
  constructor(public readonly worktree: WorktreeInfo) {
    super("worktree has uncommitted changes");
    this.name = "WorktreeDirtyError";
  }
}

export class WorktreeGitError extends Error {
  constructor(message: string, public readonly stderr?: string) {
    super(message);
    this.name = "WorktreeGitError";
  }
}

function runGit(cwd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new WorktreeGitError(`git ${args[0]} timed out`));
    }, GIT_WORKTREE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code: code ?? 1,
      });
    });
  });
}

async function gitOk(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.code !== 0) {
    throw new WorktreeGitError(`git ${args[0]} failed`, result.stderr.trim() || `exit ${result.code}`);
  }
  return result.stdout;
}

async function assertGitRepository(cwd: string): Promise<void> {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (result.code === 0 && result.stdout.trim() === "true") return;
  throw new WorktreeGitError(
    "Project folder is not a Git repository.",
    result.stderr.trim() || "Run git init in this folder to enable worktrees.",
  );
}

function randomToken(): string {
  return NAME_PARTS[Math.floor(Math.random() * NAME_PARTS.length)]!;
}

export function generateWorktreeName(): string {
  return `${randomToken()}-${randomToken()}-${randomToken()}`;
}

function withinOrEqual(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

// `.worktrees` (plural) is the container older releases used; rows created back
// then still point there and must stay deletable.
const WORKTREE_CONTAINER_DIRS = [".worktree", ".worktrees"];

function isContainedWorktreePath(projectRoot: string, worktreePath: string): boolean {
  return WORKTREE_CONTAINER_DIRS.some((dir) => {
    const rel = path.relative(path.join(projectRoot, dir), worktreePath);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

export function resolveWorktreePath(projectPath: string, name: string): string {
  if (!WORKTREE_NAME_RE.test(name)) throw new Error("invalid worktree name");
  const projectRoot = path.resolve(projectPath);
  const resolved = path.resolve(projectRoot, ".worktree", name);
  if (!withinOrEqual(resolved, projectRoot)) {
    throw new Error("worktree path escapes project root");
  }
  return resolved;
}

function toInfo(
  row: {
    id: string;
    projectId: string;
    name: string;
    path: string;
    branch: string;
    createdAt: number;
    updatedAt: number;
  },
  taskCounts?: WorktreeTaskCounts,
): WorktreeInfo {
  return { ...row, isMain: row.id === MAIN_WORKTREE_ID, taskCounts };
}

function mainInfo(
  project: NonNullable<ReturnType<typeof findProjectById>>,
  taskCounts?: WorktreeTaskCounts,
): WorktreeInfo {
  return {
    id: MAIN_WORKTREE_ID,
    projectId: project.id,
    name: MAIN_WORKTREE_ID,
    path: project.path,
    branch: project.branch,
    isMain: true,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    taskCounts,
  };
}

function emptyTaskCounts(): WorktreeTaskCounts {
  const counts = {} as WorktreeTaskCounts;
  for (const status of TASK_STATUSES) counts[status] = 0;
  return counts;
}

/** Non-archived sessions per worktree id (null key = main), across all scopes. */
function countTasksByWorktree(projectId: string): Map<string | null, WorktreeTaskCounts> {
  const byWorktree = new Map<string | null, WorktreeTaskCounts>();
  for (const task of findTasksByProjectIdAllScopes(projectId)) {
    if (task.archived) continue;
    const key = task.worktreeId ?? null;
    let counts = byWorktree.get(key);
    if (!counts) {
      counts = emptyTaskCounts();
      byWorktree.set(key, counts);
    }
    counts[task.status]++;
  }
  return byWorktree;
}

/**
 * Drop worktree rows whose directory no longer exists on disk — e.g. removed
 * with a manual `git worktree remove`/`rm -rf`, or legacy rows from before the
 * `.worktrees` → `.worktree` layout rename that `deleteWorktree` refuses to
 * touch. Their sessions cascade-delete with the row, so project task counts
 * (the pinned-icon status dots) stop reporting sessions no UI can reach.
 *
 * Skipped entirely when the project root itself is missing: an unmounted
 * drive or temporarily moved repo must not wipe worktree/session history.
 */
export function reconcileProjectWorktrees(project: { id: string; path: string }): void {
  const rows = findWorktreesByProjectId(project.id);
  if (rows.length === 0) return;
  if (!fs.existsSync(path.resolve(project.path))) return;
  let pruned = false;
  for (const row of rows) {
    if (fs.existsSync(path.resolve(row.path))) continue;
    if (deleteWorktreeRow(row.id) > 0) {
      pruned = true;
      events.emit("worktree:deleted", { id: row.id, projectId: project.id });
    }
  }
  if (pruned) events.emit("project:updated", { id: project.id });
}

export function listWorktrees(projectId: string): WorktreeInfo[] {
  const project = findProjectById(projectId);
  if (!project) throw new Error("project not found");
  reconcileProjectWorktrees(project);
  const taskCounts = countTasksByWorktree(projectId);
  return [
    mainInfo(project, taskCounts.get(null) ?? emptyTaskCounts()),
    ...findWorktreesByProjectId(projectId).map((row) =>
      toInfo(row, taskCounts.get(row.id) ?? emptyTaskCounts())
    ),
  ];
}

export function getWorktree(projectId: string, worktreeId?: string | null): WorktreeInfo {
  const normalized = normalizeWorktreeId(worktreeId);
  const project = findProjectById(projectId);
  if (!project) throw new Error("project not found");
  if (!normalized) return mainInfo(project);
  const row = findWorktreeById(normalized);
  if (!row || row.projectId !== projectId) throw new Error("worktree not found");
  return toInfo(row);
}

export function resolveProjectWorktreeCwd(projectId: string, worktreeId?: string | null): string {
  const worktree = getWorktree(projectId, worktreeId);
  const cwd = path.resolve(worktree.path);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error("worktree path does not exist on disk");
  }
  return cwd;
}

export async function createWorktree(projectId: string): Promise<{
  worktree: WorktreeInfo;
  setupCommand: string | null;
}> {
  const project = findProjectById(projectId);
  if (!project) throw new Error("project not found");
  const projectRoot = path.resolve(project.path);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error("project path does not exist on disk");
  }
  await assertGitRepository(projectRoot);
  await fs.promises.mkdir(path.join(projectRoot, ".worktree"), { recursive: true });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const name = generateWorktreeName();
    if (!WORKTREE_NAME_RE.test(name)) continue;
    if (findWorktreeByProjectAndName(projectId, name)) continue;
    const finalPath = resolveWorktreePath(projectRoot, name);
    const result = await runGit(projectRoot, ["worktree", "add", "-b", name, finalPath, "HEAD"]);
    if (result.code !== 0) {
      lastError = new WorktreeGitError("git worktree add failed", result.stderr.trim() || `exit ${result.code}`);
      if (/already exists|already checked out|branch .* exists/i.test(result.stderr)) continue;
      throw lastError;
    }
    const now = Date.now();
    const row = {
      id: newId("wt"),
      projectId,
      name,
      path: finalPath,
      branch: name,
      createdAt: now,
      updatedAt: now,
    };
    try {
      insertWorktree(row);
    } catch (e) {
      await runGit(projectRoot, ["worktree", "remove", "--force", finalPath]).catch(() => undefined);
      await fs.promises.rm(finalPath, { recursive: true, force: true }).catch(() => undefined);
      await runGit(projectRoot, ["branch", "-D", name]).catch(() => undefined);
      throw e;
    }
    events.emit("worktree:created", { id: row.id, projectId });
    events.emit("project:updated", { id: projectId });
    return {
      worktree: toInfo(row),
      setupCommand: project.worktreeSetupCommand?.trim() || null,
    };
  }
  throw lastError ?? new Error("could not generate a unique worktree name");
}

export async function deleteWorktree(input: {
  projectId: string;
  worktreeId: string;
  force?: boolean;
  stashChanges?: boolean;
}): Promise<boolean> {
  const normalized = normalizeWorktreeId(input.worktreeId);
  if (!normalized) throw new Error("main worktree cannot be deleted");
  const project = findProjectById(input.projectId);
  if (!project) throw new Error("project not found");
  const row = findWorktreeById(normalized);
  if (!row || row.projectId !== input.projectId) return false;

  const projectRoot = path.resolve(project.path);
  const worktreePath = path.resolve(row.path);
  // Don't re-derive the path from the name here: rows written by older releases
  // can carry names and container dirs the current scheme no longer generates
  // (free-form names under `.worktrees/`), and re-validating them against
  // today's rules would make those rows permanently undeletable. Deleting only
  // needs the stored path to sit safely inside a worktree container.
  if (!isContainedWorktreePath(projectRoot, worktreePath)) {
    throw new Error("worktree path is invalid");
  }

  // A previous delete that failed partway (e.g. Windows "Permission denied"
  // while a process held a handle) can leave a half-removed worktree whose
  // `.git` link is already gone, so `git status` no longer recognises it as a
  // working tree. Don't let that wedge future deletes: only consult/enforce
  // dirtiness when the worktree is still a healthy tree we can actually inspect.
  const worktreeOnDisk = fs.existsSync(worktreePath);
  const status = worktreeOnDisk
    ? await runGit(worktreePath, ["status", "--porcelain"])
    : null;
  const info = toInfo(row);
  const isDirty = status?.code === 0 && status.stdout.trim().length > 0;
  if (isDirty && input.stashChanges) {
    await gitOk(worktreePath, [
      "stash",
      "push",
      "-u",
      "-m",
      `Mission Control backup before deleting worktree ${row.name}`,
    ]);
  } else if (isDirty && !input.force) {
    throw new WorktreeDirtyError(info);
  }

  // `git worktree remove` deletes the working dir AND the admin entry under
  // `.git/worktrees/<name>`. On Windows it aborts with "Permission denied" when
  // any process still holds a handle inside the dir, leaving it half-removed —
  // and the next attempt then fails with "is not a working tree". So treat git's
  // removal as best-effort: ignore its failure, force-delete the dir ourselves
  // (retrying through the brief post-exit handle-release lag), then prune the
  // now-stale admin entry so the registration doesn't linger.
  if (worktreeOnDisk) {
    await runGit(projectRoot, [
      "worktree",
      "remove",
      ...(input.force || input.stashChanges ? ["--force"] : []),
      worktreePath,
    ]).catch(() => undefined);
  }
  await fs.promises.rm(worktreePath, {
    recursive: true,
    force: true,
    maxRetries: WORKTREE_RM_MAX_RETRIES,
    retryDelay: WORKTREE_RM_RETRY_DELAY_MS,
  });
  await runGit(projectRoot, ["worktree", "prune"]).catch(() => undefined);

  const deleted = deleteWorktreeRow(row.id) > 0;
  if (deleted) {
    events.emit("worktree:deleted", { id: row.id, projectId: input.projectId });
    events.emit("project:updated", { id: input.projectId });
  }
  return deleted;
}

export function worktreeErrorPayload(e: unknown): { message: string; stderr?: string; dirty?: boolean } {
  if (e instanceof WorktreeDirtyError) return { message: e.message, dirty: true };
  if (e instanceof WorktreeGitError) return { message: e.message, stderr: e.stderr };
  return { message: e instanceof Error ? e.message : String(e) };
}
