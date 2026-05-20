import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { MAIN_WORKTREE_ID, WORKTREE_NAME_RE, normalizeWorktreeId } from "~/shared/worktrees";
import type { WorktreeInfo } from "~/shared/worktrees";
import { findProjectById } from "../repositories/projects.repo";
import {
  deleteWorktreeRow,
  findWorktreeById,
  findWorktreeByProjectAndName,
  findWorktreesByProjectId,
  insertWorktree,
} from "../repositories/worktrees.repo";
import { newId } from "./_ids";
import { events } from "../events";

const GIT_WORKTREE_TIMEOUT_MS = 30_000;
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

export function resolveWorktreePath(projectPath: string, name: string): string {
  if (!WORKTREE_NAME_RE.test(name)) throw new Error("invalid worktree name");
  const projectRoot = path.resolve(projectPath);
  const resolved = path.resolve(projectRoot, ".worktree", name);
  if (!withinOrEqual(resolved, projectRoot)) {
    throw new Error("worktree path escapes project root");
  }
  return resolved;
}

function toInfo(row: {
  id: string;
  projectId: string;
  name: string;
  path: string;
  branch: string;
  createdAt: number;
  updatedAt: number;
}): WorktreeInfo {
  return { ...row, isMain: row.id === MAIN_WORKTREE_ID };
}

function mainInfo(project: NonNullable<ReturnType<typeof findProjectById>>): WorktreeInfo {
  return {
    id: MAIN_WORKTREE_ID,
    projectId: project.id,
    name: MAIN_WORKTREE_ID,
    path: project.path,
    branch: project.branch,
    isMain: true,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function listWorktrees(projectId: string): WorktreeInfo[] {
  const project = findProjectById(projectId);
  if (!project) throw new Error("project not found");
  return [mainInfo(project), ...findWorktreesByProjectId(projectId).map(toInfo)];
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
}): Promise<boolean> {
  const normalized = normalizeWorktreeId(input.worktreeId);
  if (!normalized) throw new Error("main worktree cannot be deleted");
  const project = findProjectById(input.projectId);
  if (!project) throw new Error("project not found");
  const row = findWorktreeById(normalized);
  if (!row || row.projectId !== input.projectId) return false;

  const projectRoot = path.resolve(project.path);
  const expectedPath = resolveWorktreePath(projectRoot, row.name);
  const worktreePath = path.resolve(row.path);
  if (worktreePath !== expectedPath) throw new Error("worktree path is invalid");
  const dirty = await gitOk(worktreePath, ["status", "--porcelain"]).catch((e) => {
    throw e;
  });
  const info = toInfo(row);
  if (dirty.trim() && !input.force) throw new WorktreeDirtyError(info);

  await gitOk(projectRoot, [
    "worktree",
    "remove",
    ...(input.force ? ["--force"] : []),
    worktreePath,
  ]);
  await fs.promises.rm(worktreePath, { recursive: true, force: true });
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
