import * as fs from "node:fs";
import * as path from "node:path";
import { getSqlite } from "~/db/client";
import {
  DEFAULT_BRANCH,
  LAUNCH_COMMANDS_MAX,
  CUSTOM_SCRIPTS_MAX,
  TASK_STATUSES,
  isActiveStatus,
  isTaskStatus,
  normalizeScriptArgs,
} from "~/shared/domain";
import { normalizeRepoRemote } from "~/shared/repo-key";
import type { CustomScript, LaunchCommand, TaskStatus } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";
import type { ProjectPathStatus, ProjectWithCounts } from "~/shared/projects";
import { events } from "../events";
import { ValidationError } from "../errors";
import {
  deleteProjectRow,
  findAllProjects,
  findProjectById,
  insertProject,
  updateProjectRow,
} from "../repositories/projects.repo";
import { findWorktreeById } from "../repositories/worktrees.repo";
import { findTasksByProjectId } from "../repositories/tasks.repo";
import { deleteAllProjectImagesFor } from "./project-images";
import { reconcileProjectWorktrees } from "./worktrees";
import { newId } from "./_ids";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";
import { getPinnedProjects, nextPinnedOrder, validatePinnedReorder } from "~/lib/pinned-project-order";

export type { ProjectWithCounts } from "~/shared/projects";

function validateWorkingDirectory(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) throw new ValidationError("Working directory is required");
  if (!fs.existsSync(trimmed)) throw new ValidationError("Working directory does not exist");
  const stat = fs.statSync(trimmed);
  if (!stat.isDirectory()) throw new ValidationError("Working directory must be a directory");
  try {
    fs.accessSync(trimmed, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    throw new ValidationError("Working directory is not readable");
  }
  return trimmed;
}

function pathStatusFor(
  target: string,
  scope: ProjectPathStatus["scope"],
  worktreeId?: string | null,
): ProjectPathStatus {
  try {
    if (!fs.existsSync(target)) {
      return {
        ok: false,
        path: target,
        scope,
        worktreeId,
        reason: "missing",
        message:
          scope === "worktree"
            ? "Mission Control cannot find this worktree folder."
            : "Mission Control cannot find this project folder.",
      };
    }
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        path: target,
        scope,
        worktreeId,
        reason: "not-directory",
        message: "This path exists, but it is not a directory.",
      };
    }
    fs.accessSync(target, fs.constants.R_OK | fs.constants.X_OK);
    return { ok: true, path: target, scope, worktreeId };
  } catch {
    return {
      ok: false,
      path: target,
      scope,
      worktreeId,
      reason: "unreadable",
      message: "Mission Control cannot read this working directory.",
    };
  }
}

export function getProjectPathStatus(
  id: string,
  worktreeId?: string | null,
): ProjectPathStatus | null {
  const project = findProjectById(id);
  if (!project) return null;
  if (worktreeId && worktreeId !== MAIN_WORKTREE_ID) {
    const worktree = findWorktreeById(worktreeId);
    if (!worktree || worktree.projectId !== id) return null;
    return pathStatusFor(worktree.path, "worktree", worktreeId);
  }
  return pathStatusFor(project.path, "project", null);
}

// readOriginRemoteUrl runs inside decorate() (feeding both githubUrl and the
// multiplayer-pets repo key), which fires for every project on every
// listProjects(); /api/projects re-lists on each project:*/task:* SSE event,
// so a burst of agent activity re-read and re-parsed each .git/config many
// times a minute. Cache the raw origin url per path, keyed by the config
// file's mtime so an external remote change still refreshes. The statSync
// itself is cheap and runs every call — only the read + regex is skipped on a
// hit. `mtimeMs: -1` records a "no config" result (missing file, or a worktree
// whose .git is a file) so repeated misses don't churn; it invalidates the
// moment a real config appears with a genuine mtime.
type OriginUrlCacheEntry = { mtimeMs: number; url: string | null };
const originUrlCache = new Map<string, OriginUrlCacheEntry>();

/** Test seam: drop cached origin-url reads so a test can force a re-read. */
export function _resetGithubUrlCache(): void {
  originUrlCache.clear();
}

/** Raw `origin` remote url from a repo's .git/config, or null. Cached by mtime. */
function readOriginRemoteUrl(dir: string): string | null {
  const cfg = path.join(dir, ".git", "config");
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(cfg).mtimeMs;
  } catch {
    // Missing config, or .git is a file (worktree) — matches the pre-cache
    // behavior of returning null for anything that isn't a readable config.
    originUrlCache.set(dir, { mtimeMs: -1, url: null });
    return null;
  }
  const cached = originUrlCache.get(dir);
  if (cached && cached.mtimeMs === mtimeMs) return cached.url;
  let url: string | null;
  try {
    const text = fs.readFileSync(cfg, "utf8");
    const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    url = m ? m[1].trim() : null;
  } catch {
    url = null;
  }
  originUrlCache.set(dir, { mtimeMs, url });
  return url;
}

/** Normalize a raw origin url to https://github.com/owner/repo, or null. Pure. */
function githubUrlFromRemote(url: string | null): string | null {
  if (!url) return null;
  // git@github.com:owner/repo(.git)
  const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  // ssh://git@github.com/owner/repo(.git) or https://github.com/owner/repo(.git)
  const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
  if (https) return `https://github.com/${https[1]}`;
  return null;
}

export function detectGithubUrl(dir: string): string | null {
  return githubUrlFromRemote(readOriginRemoteUrl(dir));
}

export function detectBranch(dir: string): string {
  try {
    const headFile = path.join(dir, ".git", "HEAD");
    if (!fs.existsSync(headFile)) return DEFAULT_BRANCH;
    const content = fs.readFileSync(headFile, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) return content.replace("ref: refs/heads/", "");
    return content.slice(0, 7);
  } catch {
    return DEFAULT_BRANCH;
  }
}

function emptyStatusCounts(): Record<TaskStatus, number> {
  return TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = 0;
      return acc;
    },
    {} as Record<TaskStatus, number>,
  );
}

export function listProjects(): ProjectWithCounts[] {
  const rows = findAllProjects();
  // Sessions on externally-deleted worktrees cascade away with their rows, so
  // taskCounts (the pinned-icon status dots) only report reachable sessions.
  // Runs before the aggregate queries below so cascaded deletions are reflected.
  for (const p of rows) reconcileProjectWorktrees(p);

  // Aggregate non-archived task counts per (project, status) in SQLite instead
  // of loading every task row and filtering it per project in JS (was O(P×T)).
  type Agg = { counts: Record<TaskStatus, number>; total: number; activeNonDone: number };
  const aggByProject = new Map<string, Agg>();
  const statusCountRows = getSqlite()
    .prepare(
      `SELECT project_id AS projectId, status, COUNT(*) AS c
         FROM tasks
        WHERE archived = 0
        GROUP BY project_id, status`,
    )
    .all() as { projectId: string; status: string; c: number }[];
  for (const r of statusCountRows) {
    let agg = aggByProject.get(r.projectId);
    if (!agg) {
      agg = { counts: emptyStatusCounts(), total: 0, activeNonDone: 0 };
      aggByProject.set(r.projectId, agg);
    }
    agg.total += r.c;
    if (isTaskStatus(r.status)) {
      agg.counts[r.status] = r.c;
      if (isActiveStatus(r.status) && r.status !== "finished") agg.activeNonDone += r.c;
    }
  }

  // Preview text mirrors decorate()'s `active.find(running) ?? active.find(needs-input)`
  // over the rowid-ordered task scan: the earliest-inserted running task wins,
  // else the earliest needs-input task. Only active session rows qualify — a
  // tiny set — so this narrow query stays cheap.
  const runningPreview = new Map<string, string>();
  const needsInputPreview = new Map<string, string>();
  const previewRows = getSqlite()
    .prepare(
      `SELECT project_id AS projectId, status, preview
         FROM tasks
        WHERE archived = 0 AND status IN ('running', 'needs-input')
        ORDER BY rowid`,
    )
    .all() as { projectId: string; status: string; preview: string }[];
  for (const r of previewRows) {
    const target = r.status === "running" ? runningPreview : needsInputPreview;
    if (!target.has(r.projectId)) target.set(r.projectId, r.preview);
  }

  return rows.map((p) => {
    const agg = aggByProject.get(p.id);
    const counts = agg?.counts ?? emptyStatusCounts();
    const preview = runningPreview.get(p.id) ?? needsInputPreview.get(p.id) ?? null;
    // Same origin read as decorate() — multiplayer pets needs repoKey on the
    // list endpoint (usePetMultiplayer reads projects from useProjects()).
    const originRemote = readOriginRemoteUrl(p.path);
    return {
      ...p,
      taskCounts: { ...counts, total: agg?.total ?? 0, activeNonDone: agg?.activeNonDone ?? 0 },
      preview,
      githubUrl: githubUrlFromRemote(originRemote),
      repoKey: normalizeRepoRemote(originRemote),
    };
  });
}

export function getProject(id: string): ProjectWithCounts | null {
  const p = findProjectById(id);
  if (!p) return null;
  reconcileProjectWorktrees(p);
  return decorate(p, findTasksByProjectId(id));
}

function decorate(p: Project, ts: Task[]): ProjectWithCounts {
  const active = ts.filter((t) => !t.archived);
  const counts = TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = 0;
      return acc;
    },
    {} as Record<TaskStatus, number>
  );
  let activeNonDone = 0;
  for (const t of active) {
    counts[t.status]++;
    if (isActiveStatus(t.status) && t.status !== "finished") activeNonDone++;
  }
  const previewSource =
    active.find((t) => t.status === "running") ?? active.find((t) => t.status === "needs-input");
  // Read .git/config once and derive both the GitHub url and the (any-host)
  // repo key from it, rather than reading + parsing the file twice per project.
  const originRemote = readOriginRemoteUrl(p.path);
  return {
    ...p,
    taskCounts: { ...counts, total: active.length, activeNonDone },
    preview: previewSource?.preview ?? null,
    githubUrl: githubUrlFromRemote(originRemote),
    repoKey: normalizeRepoRemote(originRemote),
  };
}

export function createProject(input: {
  name?: string;
  path: string;
  icon?: string;
  iconColor?: string;
  groupId?: string | null;
  /** Scope to create the project in: a sandbox id, or null/undefined = Local. */
  sandboxId?: string | null;
}): Project {
  const localPath = validateWorkingDirectory(input.path ?? "");

  const name = input.name?.trim() || path.basename(localPath) || "project";

  const now = Date.now();
  const id = newId("p");
  const branch = detectBranch(localPath);
  const row = {
    id,
    name,
    path: localPath,
    icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
    iconColor: input.iconColor || "#ff5a1f",
    imagePath: null,
    groupId: input.groupId ?? null,
    // Inherits the scope the project was created in (Local when null/undefined).
    sandboxId: input.sandboxId ?? null,
    pinned: false,
    pinnedOrder: null,
    branch,
    launchCommands: null,
    customScripts: null,
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: now,
    updatedAt: now,
  };
  insertProject(row);
  events.emit("project:created", { id });
  return row;
}

export function updateProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "path"
      | "icon"
      | "iconColor"
      | "imagePath"
      | "groupId"
      | "pinned"
      | "pinnedOrder"
      | "branch"
      | "launchUrl"
      | "worktreeSetupCommand"
      | "rememberAgentSettings"
      | "savedAgent"
      | "savedSkipPermissions"
      | "savedBareSession"
    >
  > & { launchCommands?: LaunchCommand[] | null; customScripts?: CustomScript[] | null }
): Project | null {
  const existing = findProjectById(id);
  if (!existing) return null;
  const { launchCommands, customScripts, ...rest } = patch;
  const nextPath =
    rest.path !== undefined ? validateWorkingDirectory(rest.path) : undefined;
  if (
    rest.worktreeSetupCommand !== undefined &&
    rest.worktreeSetupCommand !== null &&
    rest.worktreeSetupCommand.length > 500
  ) {
    throw new Error("worktreeSetupCommand cannot exceed 500 characters");
  }
  const updated = {
    ...existing,
    ...rest,
    ...(rest.pinned !== undefined
      ? {
          pinned: rest.pinned,
          pinnedOrder: rest.pinned
            ? rest.pinnedOrder ??
              existing.pinnedOrder ??
              nextPinnedOrder(findAllProjects())
            : null,
        }
      : {}),
    ...(nextPath !== undefined
      ? {
          path: nextPath,
          branch: rest.branch ?? detectBranch(nextPath),
        }
      : {}),
    ...(rest.worktreeSetupCommand !== undefined
      ? { worktreeSetupCommand: rest.worktreeSetupCommand?.trim() || null }
      : {}),
    ...(launchCommands !== undefined
      ? { launchCommands: serializeLaunchCommands(launchCommands) }
      : {}),
    ...(customScripts !== undefined
      ? { customScripts: serializeCustomScripts(customScripts) }
      : {}),
    updatedAt: Date.now(),
  };
  updateProjectRow(id, updated);
  events.emit("project:updated", { id });
  return updated;
}

function serializeCommandList(
  input: LaunchCommand[] | null,
  max: number,
  field: string
): string | null {
  if (!input) return null;
  if (!Array.isArray(input)) throw new ValidationError(`${field} must be an array`);
  if (input.length > max) {
    throw new ValidationError(`${field} cannot exceed ${max} entries`);
  }
  const cleaned = input.map((c) => {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "").trim();
    const command = String(c?.command ?? "").trim();
    if (!id) throw new ValidationError(`${field}: id is required`);
    if (!name) throw new ValidationError(`${field}: name is required`);
    if (!command) throw new ValidationError(`${field}: command is required`);
    return { id, name, command };
  });
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

function serializeLaunchCommands(input: LaunchCommand[] | null): string | null {
  return serializeCommandList(input, LAUNCH_COMMANDS_MAX, "launchCommands");
}

function serializeCustomScripts(input: CustomScript[] | null): string | null {
  if (!input) return null;
  if (!Array.isArray(input)) throw new ValidationError("customScripts must be an array");
  if (input.length > CUSTOM_SCRIPTS_MAX) {
    throw new ValidationError(`customScripts cannot exceed ${CUSTOM_SCRIPTS_MAX} entries`);
  }
  const cleaned = input.map((c) => {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "").trim();
    const command = String(c?.command ?? "").trim();
    if (!id) throw new ValidationError("customScripts: id is required");
    if (!name) throw new ValidationError("customScripts: name is required");
    if (!command) throw new ValidationError("customScripts: command is required");
    // serializeCommandList would strip args; preserve the normalized arg list.
    const args = normalizeScriptArgs(c?.args);
    return args ? { id, name, command, args } : { id, name, command };
  });
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

export function togglePin(id: string): Project | null {
  const togglePinned = getSqlite().transaction(() => {
    const existing = findProjectById(id);
    if (!existing) return null;
    const pinning = !existing.pinned;
    const now = Date.now();
    const pinnedOrder = pinning ? nextPinnedOrder(findAllProjects()) : null;
    const next = { ...existing, pinned: pinning, pinnedOrder, updatedAt: now };
    updateProjectRow(id, { pinned: pinning, pinnedOrder, updatedAt: now });
    return next;
  });
  const next = togglePinned.immediate();
  if (next) events.emit("project:updated", { id });
  return next;
}

export function reorderPinnedProjects(order: string[]): ProjectWithCounts[] {
  const updatePinnedOrder = getSqlite().transaction(() => {
    const pinned = getPinnedProjects(findAllProjects());
    try {
      validatePinnedReorder(order, pinned);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "invalid pinned order");
    }
    const now = Date.now();
    for (let index = 0; index < order.length; index++) {
      updateProjectRow(order[index]!, { pinnedOrder: index, updatedAt: now });
    }
  });
  updatePinnedOrder.immediate();
  for (const id of order) events.emit("project:updated", { id });
  return listProjects();
}

export function deleteProject(id: string): boolean {
  const changes = deleteProjectRow(id);
  if (changes > 0) deleteAllProjectImagesFor(id);
  events.emit("project:deleted", { id });
  return changes > 0;
}

export function refreshBranch(id: string): string | null {
  const p = findProjectById(id);
  if (!p) return null;
  const branch = detectBranch(p.path);
  if (branch !== p.branch) {
    updateProjectRow(id, { branch, updatedAt: Date.now() });
    events.emit("project:updated", { id });
  }
  return branch;
}
