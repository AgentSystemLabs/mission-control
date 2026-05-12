import { and, asc, eq, ne, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "~/db/client";
import { projects, tasks } from "~/db/schema";
import { DEFAULT_BRANCH, LAUNCH_COMMANDS_MAX, TASK_STATUSES, isActiveStatus } from "~/shared/domain";
import type { LaunchCommand, TaskStatus } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";
import type { ProjectWithCounts } from "~/shared/projects";
import { FREE_PROJECT_CAP, isProTier } from "~/shared/license";
import { events } from "../events";
import { deleteAllProjectImagesFor } from "./project-images";
import { readLicenseState } from "./license";
import { listTasksForProject } from "./tasks";
import { listUserTerminals } from "./user-terminals";

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
  constructor(public readonly path: string) {
    super(`A project for "${path}" already exists.`);
    this.name = "DuplicateProjectPathError";
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    e.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    (typeof e.message === "string" && /UNIQUE constraint failed/i.test(e.message))
  );
}

export type { ProjectWithCounts } from "~/shared/projects";

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

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
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
  const db = getDb();
  const rows = db.select().from(projects).orderBy(asc(projects.createdAt)).all();
  const allTasks = db.select().from(tasks).all();
  return rows.map((p) => decorate(p, allTasks.filter((t) => t.projectId === p.id)));
}

export function getProject(id: string): ProjectWithCounts | null {
  const db = getDb();
  const p = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!p) return null;
  const ts = db.select().from(tasks).where(eq(tasks.projectId, id)).all();
  return decorate(p, ts);
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
  if (!input.path?.trim()) throw new Error("Working directory is required");
  if (!fs.existsSync(input.path)) throw new Error("Working directory does not exist");
  const stat = fs.statSync(input.path);
  if (!stat.isDirectory()) throw new Error("Working directory must be a directory");

  const name = input.name?.trim() || path.basename(input.path) || "project";

  const db = getDb();

  const pro = isProTier(readLicenseState());
  const now = Date.now();
  const id = newId("p");
  const branch = detectBranch(input.path);
  const row = {
    id,
    name,
    path: input.path,
    icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
    iconColor: input.iconColor || "#ff5a1f",
    imagePath: null,
    groupId: input.groupId ?? null,
    pinned: false,
    branch,
    launchCommands: null,
    launchUrl: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Cap check + insert must be atomic; otherwise two concurrent
    // createProject calls can both pass the cap check before either inserts.
    db.transaction((tx) => {
      if (!pro) {
        const existing = tx.select({ id: projects.id }).from(projects).all();
        if (existing.length >= FREE_PROJECT_CAP) {
          throw new ProjectCapExceededError(FREE_PROJECT_CAP, existing.length);
        }
      }
      tx.insert(projects).values(row).run();
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateProjectPathError(input.path);
    }
    throw err;
  }

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
      | "rememberAgentSettings"
      | "savedAgent"
      | "savedSkipPermissions"
      | "savedBareSession"
    >
  > & { launchCommands?: LaunchCommand[] | null }
): Project | null {
  const db = getDb();
  const { launchCommands, ...rest } = patch;
  const setPatch: Partial<Project> & { updatedAt: number } = {
    ...rest,
    ...(launchCommands !== undefined
      ? { launchCommands: serializeLaunchCommands(launchCommands) }
      : {}),
    updatedAt: Date.now(),
  };
  let updated: Project | undefined;
  try {
    updated = db
      .update(projects)
      .set(setPatch)
      .where(eq(projects.id, id))
      .returning()
      .get();
  } catch (err) {
    if (isUniqueConstraintError(err) && patch.path !== undefined) {
      throw new DuplicateProjectPathError(String(patch.path));
    }
    throw err;
  }
  if (!updated) return null;
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
  const db = getDb();
  const updated = db
    .update(projects)
    .set({ pinned: sql`NOT ${projects.pinned}`, updatedAt: Date.now() })
    .where(eq(projects.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("project:updated", { id });
  return updated;
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const taskIds = listTasksForProject(id).map((t) => t.id);
  const userTerminalIds = listUserTerminals(id).map((t) => t.id);
  const result = db.delete(projects).where(eq(projects.id, id)).run();
  if (result.changes > 0) {
    deleteAllProjectImagesFor(id);
    for (const tid of taskIds) events.emit("task:deleted", { id: tid, projectId: id });
    for (const utid of userTerminalIds)
      events.emit("user-terminal:deleted", { id: utid, projectId: id });
  }
  events.emit("project:deleted", { id, taskIds, userTerminalIds });
  return result.changes > 0;
}

export function refreshBranch(id: string): string | null {
  const db = getDb();
  const p = db
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  if (!p) return null;
  // fs I/O kept outside the DB write
  const branch = detectBranch(p.path);
  const updated = db
    .update(projects)
    .set({ branch, updatedAt: Date.now() })
    .where(and(eq(projects.id, id), ne(projects.branch, branch)))
    .returning({ id: projects.id })
    .get();
  if (updated) events.emit("project:updated", { id });
  return branch;
}
