import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { getRepositories } from "../repositories";
import { RepositoryProjectCapExceededError, type UserScope } from "../repositories/types";
import { isUniqueConstraintError as isSqliteUniqueConstraintError } from "../repositories/sqlite";
import { isUniqueConstraintError as isPostgresUniqueConstraintError } from "../repositories/postgres";
import { DEFAULT_BRANCH, LAUNCH_COMMANDS_MAX, type LaunchCommand } from "~/shared/domain";
import type { Project } from "~/db/schema";
import type { ProjectWithCounts } from "~/shared/projects";
import { isProTier } from "~/shared/license";
import { events } from "../events";
import { deleteAllProjectImagesFor } from "./project-images";
import { normalizeProjectImageDataUrl } from "../lib/project-image-data";
import { readLicenseState } from "./license";
import { deleteDaytonaSandboxById } from "../runtime/daytona-cleanup";
import { serverEnv } from "~/shared/env";

const ALLOWED_CLOUD_GIT_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

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

export class DuplicateProjectPathError extends Error {
  constructor(
    public readonly path: string,
    targetDescription = "this working directory",
  ) {
    super(`A project for ${targetDescription} already exists.`);
    this.name = "DuplicateProjectPathError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return isSqliteUniqueConstraintError(err) || isPostgresUniqueConstraintError(err);
}

export type { ProjectWithCounts } from "~/shared/projects";

export async function detectGithubUrl(dir: string): Promise<string | null> {
  try {
    const cfg = path.join(dir, ".git", "config");
    let text: string;
    try {
      text = await fsp.readFile(cfg, "utf8");
    } catch {
      return null;
    }
    return parseGithubUrlFromConfig(text);
  } catch {
    return null;
  }
}

/** Sync sibling of {@link detectGithubUrl}. Used by updateProject so a path
 * change can repopulate the cached github_url column without making the whole
 * call site async. */
export function detectGithubUrlSync(dir: string): string | null {
  try {
    const cfg = path.join(dir, ".git", "config");
    let text: string;
    try {
      text = fs.readFileSync(cfg, "utf8");
    } catch {
      return null;
    }
    return parseGithubUrlFromConfig(text);
  } catch {
    return null;
  }
}

function parseGithubUrlFromConfig(text: string): string | null {
  const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
  if (!m) return null;
  const url = m[1].trim();
  // git@github.com:owner/repo(.git)
  const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;
  // ssh://git@github.com/owner/repo(.git) or https://github.com/owner/repo(.git)
  const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
  if (https) return `https://github.com/${https[1]}`;
  return null;
}

export function normalizeGitRepositoryUrl(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProjectValidationError("Git repository URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new ProjectValidationError("Git repository URL must use HTTPS");
  }
  if (url.port && url.port !== "443") {
    throw new ProjectValidationError("Git repository URL must use the default HTTPS port");
  }
  if (!ALLOWED_CLOUD_GIT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ProjectValidationError("Git repository host is not supported in cloud mode");
  }
  if (url.username || url.password) {
    throw new ProjectValidationError("Git repository URL must not include credentials");
  }
  if (url.search || url.hash) {
    throw new ProjectValidationError("Git repository URL must not include query parameters or fragments");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new ProjectValidationError("Git repository URL must include a repository path");
  }
  return `${url.origin}${pathname}`;
}

function slugPart(value: string): string {
  return (
    value
      .replace(/\.git$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  );
}

const DEFAULT_DAYTONA_WORKSPACE_ROOT = "workspace";

export function deriveCloudWorkspacePath(repoUrl: string): string {
  const url = new URL(repoUrl);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const slug = parts.slice(-2).map(slugPart).join("-");
  const root = serverEnv().DAYTONA_WORKSPACE_PATH ?? DEFAULT_DAYTONA_WORKSPACE_ROOT;
  return path.posix.join(root, slug || "repo");
}

function deriveCloudProjectName(repoUrl: string): string {
  const url = new URL(repoUrl);
  const name = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  return name ? slugPart(name) : "project";
}

async function detectBranch(dir: string): Promise<string> {
  try {
    const headFile = path.join(dir, ".git", "HEAD");
    let content: string;
    try {
      content = (await fsp.readFile(headFile, "utf8")).trim();
    } catch {
      return DEFAULT_BRANCH;
    }
    if (content.startsWith("ref: refs/heads/")) return content.replace("ref: refs/heads/", "");
    return content.slice(0, 7);
  } catch {
    return DEFAULT_BRANCH;
  }
}

export async function listProjects(ownerUserId?: string | null): Promise<ProjectWithCounts[]> {
  return getRepositories().projects.list({ userId: ownerUserId });
}

export async function getProject(id: string): Promise<ProjectWithCounts | null> {
  return getRepositories().projects.get(id);
}

/**
 * Sync, undecorated lookup for callers that only need the raw project row
 * (e.g. resolving a project's working directory) — avoids the async fs hop
 * detectGithubUrl now triggers.
 */
export async function getProjectRow(id: string): Promise<Project | null> {
  return getRepositories().projects.getRow(id);
}

export async function createProject(input: {
  name?: string;
  path?: string;
  icon?: string;
  iconColor?: string;
  imageDataUrl?: string | null;
  groupId?: string | null;
  runtimeKind?: string;
  ownerUserId?: string | null;
  sandboxId?: string | null;
  workspacePath?: string | null;
  repoUrl?: string | null;
  sandboxState?: string | null;
}): Promise<Project> {
  const runtimeKind = input.runtimeKind ?? "local";
  const repoUrl = normalizeGitRepositoryUrl(input.repoUrl);
  if (runtimeKind !== "local" && !repoUrl) {
    throw new Error("Git repository URL is required in cloud mode");
  }
  const projectPath =
    runtimeKind === "local"
      ? (input.path?.trim() ?? "")
      : deriveCloudWorkspacePath(repoUrl!);
  if (runtimeKind === "local") {
    if (!projectPath) throw new ProjectValidationError("Working directory is required");
    if (!fs.existsSync(projectPath)) {
      throw new ProjectValidationError("Working directory does not exist");
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(projectPath);
    } catch {
      throw new ProjectValidationError("Working directory is not accessible");
    }
    if (!stat.isDirectory()) {
      throw new ProjectValidationError("Working directory must be a directory");
    }
  }
  const projectName =
    input.name?.trim() || (runtimeKind === "local" ? undefined : deriveCloudProjectName(repoUrl!));
  try {
    const row = await getRepositories().projects.create({
      ...input,
      imageDataUrl:
        input.imageDataUrl !== undefined
          ? normalizeProjectImageDataUrl(input.imageDataUrl)
          : undefined,
      name: projectName,
      path: projectPath,
      workspacePath: input.workspacePath ?? (runtimeKind === "local" ? input.workspacePath : projectPath),
      repoUrl,
      runtimeKind,
      pro: isProTier(await readLicenseState(input.ownerUserId ?? undefined)),
    });
    events.emit("project:created", { id: row.id });
    return row;
  } catch (err) {
    if (err instanceof RepositoryProjectCapExceededError) {
      throw new ProjectCapExceededError(err.limit, err.current);
    }
    if (isUniqueConstraintError(err)) {
      throw new DuplicateProjectPathError(
        projectPath,
        runtimeKind === "local" ? "this working directory" : "this Git repository",
      );
    }
    throw err;
  }
}

export async function updateProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "path"
      | "icon"
      | "iconColor"
      | "imagePath"
      | "imageDataUrl"
      | "groupId"
      | "pinned"
      | "branch"
      | "launchUrl"
      | "runtimeKind"
      | "ownerUserId"
      | "sandboxId"
      | "workspacePath"
      | "repoUrl"
      | "sandboxState"
      | "rememberAgentSettings"
      | "savedAgent"
      | "savedSkipPermissions"
      | "savedBareSession"
    >
  > & { launchCommands?: LaunchCommand[] | null },
  scope?: UserScope,
): Promise<Project | null> {
  try {
    const imageDataUrl =
      patch.imageDataUrl !== undefined
        ? normalizeProjectImageDataUrl(patch.imageDataUrl)
        : undefined;
    const imagePath = patch.imagePath === "" ? null : patch.imagePath;
    if (imagePath && imageDataUrl) {
      throw new Error("Choose either a local image path or image data URL");
    }
    const normalizedPatch = {
      ...patch,
      ...(patch.imagePath !== undefined ? { imagePath } : {}),
      ...(patch.imageDataUrl !== undefined ? { imageDataUrl } : {}),
      ...(imageDataUrl ? { imagePath: null } : {}),
      ...(imagePath ? { imageDataUrl: null } : {}),
      ...(imagePath === null && patch.imageDataUrl === undefined
        ? { imageDataUrl: null }
        : {}),
    };
    const updated = await getRepositories().projects.update(id, normalizedPatch, scope);
    if (updated) events.emit("project:updated", { id });
    return updated;
  } catch (err) {
    if (isUniqueConstraintError(err) && patch.path !== undefined) {
      throw new DuplicateProjectPathError(String(patch.path));
    }
    throw err;
  }
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

export async function togglePin(id: string): Promise<Project | null> {
  const updated = await getRepositories().projects.togglePin(id);
  if (!updated) return null;
  events.emit("project:updated", { id });
  return updated;
}

export async function deleteProject(id: string): Promise<boolean> {
  const result = await getRepositories().projects.delete(id);
  if (result.deleted) {
    const { existing, taskIds, userTerminalIds } = result;
    if (existing?.sandboxId) void deleteDaytonaSandboxById(existing.sandboxId);
    deleteAllProjectImagesFor(id);
    for (const tid of taskIds) events.emit("task:deleted", { id: tid, projectId: id });
    for (const utid of userTerminalIds)
      events.emit("user-terminal:deleted", { id: utid, projectId: id });
  }
  events.emit("project:deleted", {
    id,
    taskIds: result.taskIds,
    userTerminalIds: result.userTerminalIds,
  });
  return result.deleted;
}

export async function refreshBranch(id: string): Promise<string | null> {
  const p = await getRepositories().projects.getRow(id);
  if (!p) return null;
  if (p.runtimeKind !== "local") return p.branch;
  // fs I/O kept outside the DB write
  const branch = await detectBranch(p.path);
  if (p.branch !== branch) {
    await getRepositories().projects.refreshBranch(id, branch);
    events.emit("project:updated", { id });
  }
  return branch;
}
