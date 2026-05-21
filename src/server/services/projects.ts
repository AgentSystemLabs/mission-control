import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_BRANCH, LAUNCH_COMMANDS_MAX, TASK_STATUSES, isActiveStatus } from "~/shared/domain";
import type { LaunchCommand, TaskStatus } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";
import type { ProjectPathStatus, ProjectWithCounts } from "~/shared/projects";
import { FREE_PROJECT_CAP, isProTier } from "~/shared/license";
import { events } from "../events";
import { ValidationError } from "../errors";
import {
  deleteProjectRow,
  findAllProjects,
  findProjectById,
  findProjectIds,
  insertProject,
  updateProjectRow,
} from "../repositories/projects.repo";
import { findWorktreeById } from "../repositories/worktrees.repo";
import { findAllTasks, findTasksByProjectId } from "../repositories/tasks.repo";
import { deleteAllProjectImagesFor } from "./project-images";
import { readLicenseState } from "./license";
import { newId } from "./_ids";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

export class ProjectCapExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(
      `Mission Control Lite is limited to ${limit} projects. Upgrade to Pro for unlimited projects.`,
    );
    this.name = "ProjectCapExceededError";
  }
}

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
    const m = text.match(/\[remote "origin"\][^\[]*?url\s*=\s*(\S+)/);
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
}): Project {
  const localPath = validateWorkingDirectory(input.path ?? "");

  const name = input.name?.trim() || path.basename(localPath) || "project";

  if (!isProTier(readLicenseState())) {
    const existing = findProjectIds();
    if (existing.length >= FREE_PROJECT_CAP) {
      throw new ProjectCapExceededError(FREE_PROJECT_CAP, existing.length);
    }
  }

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
    pinned: false,
    branch,
    launchCommands: null,
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
      | "branch"
      | "launchUrl"
      | "worktreeSetupCommand"
      | "rememberAgentSettings"
      | "savedAgent"
      | "savedSkipPermissions"
      | "savedBareSession"
    >
  > & { launchCommands?: LaunchCommand[] | null }
): Project | null {
  const existing = findProjectById(id);
  if (!existing) return null;
  const { launchCommands, ...rest } = patch;
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
    updatedAt: Date.now(),
  };
  updateProjectRow(id, updated);
  events.emit("project:updated", { id });
  return updated;
}

function serializeLaunchCommands(input: LaunchCommand[] | null): string | null {
  if (!input) return null;
  if (!Array.isArray(input)) throw new Error("launchCommands must be an array");
  if (input.length > LAUNCH_COMMANDS_MAX) {
    throw new Error(`launchCommands cannot exceed ${LAUNCH_COMMANDS_MAX} entries`);
  }
  const cleaned = input.map((c) => {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "").trim();
    const command = String(c?.command ?? "").trim();
    if (!id) throw new Error("launchCommands: id is required");
    if (!name) throw new Error("launchCommands: name is required");
    if (!command) throw new Error("launchCommands: command is required");
    return { id, name, command };
  });
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

export function togglePin(id: string): Project | null {
  const existing = findProjectById(id);
  if (!existing) return null;
  const next = { ...existing, pinned: !existing.pinned, updatedAt: Date.now() };
  updateProjectRow(id, { pinned: next.pinned, updatedAt: next.updatedAt });
  events.emit("project:updated", { id });
  return next;
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
