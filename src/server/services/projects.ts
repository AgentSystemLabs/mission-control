import * as fs from "node:fs";
import * as path from "node:path";
import { getSqlite } from "~/db/client";
import {
  DEFAULT_BRANCH,
  LAUNCH_COMMANDS_MAX,
  CUSTOM_SCRIPTS_MAX,
  TASK_STATUSES,
  isActiveStatus,
} from "~/shared/domain";
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
import { findAllTasks, findTasksByProjectId } from "../repositories/tasks.repo";
import { deleteAllProjectImagesFor } from "./project-images";
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

export function detectGithubUrl(dir: string): string | null {
  try {
    const cfg = path.join(dir, ".git", "config");
    if (!fs.existsSync(cfg)) return null;
    const text = fs.readFileSync(cfg, "utf8");
    const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    if (!m) return null;
    let url = m[1].trim();
    // git@github.com:owner/repo(.git)
    const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}`;
    // ssh://git@github.com/owner/repo(.git) or https://github.com/owner/repo(.git)
    const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (https) return `https://github.com/${https[1]}`;
    return null;
  } catch {
    return null;
  }
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

export function listProjects(): ProjectWithCounts[] {
  const rows = findAllProjects();
  const allTasks = findAllTasks();
  return rows.map((p) => decorate(p, allTasks.filter((t) => t.projectId === p.id)));
}

export function getProject(id: string): ProjectWithCounts | null {
  const p = findProjectById(id);
  if (!p) return null;
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
  return {
    ...p,
    taskCounts: { ...counts, total: active.length, activeNonDone },
    preview: previewSource?.preview ?? null,
    githubUrl: detectGithubUrl(p.path),
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
              nextPinnedOrder(projectsInScope(findAllProjects(), existing.sandboxId))
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
  return serializeCommandList(input, CUSTOM_SCRIPTS_MAX, "customScripts");
}

function projectsInScope(all: readonly Project[], sandboxId: string | null): Project[] {
  return all.filter((p) => p.sandboxId === sandboxId);
}

export function togglePin(id: string): Project | null {
  const togglePinned = getSqlite().transaction(() => {
    const existing = findProjectById(id);
    if (!existing) return null;
    const pinning = !existing.pinned;
    const now = Date.now();
    const pinnedOrder = pinning
      ? nextPinnedOrder(projectsInScope(findAllProjects(), existing.sandboxId))
      : null;
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
    if (order.length === 0) return;
    const anchor = findProjectById(order[0]!);
    if (!anchor) throw new ValidationError("invalid pinned order");
    const scoped = projectsInScope(findAllProjects(), anchor.sandboxId);
    const pinned = getPinnedProjects(scoped);
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
