import { eq, asc, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { getDb } from "~/db/client";
import { projects, tasks } from "~/db/schema";
import { DEFAULT_BRANCH, LAUNCH_COMMANDS_MAX, TASK_STATUSES, isActiveStatus } from "~/shared/domain";
import type { LaunchCommand, TaskStatus } from "~/shared/domain";
import type { Project } from "~/db/schema";
import type { ProjectWithCounts } from "~/shared/projects";
import { FREE_PROJECT_CAP, isProTier } from "~/shared/license";
import { events } from "../events";
import { deleteAllProjectImagesFor } from "./project-images";
import { readLicenseState } from "./license";

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

export async function detectGithubUrl(dir: string): Promise<string | null> {
  try {
    const cfg = path.join(dir, ".git", "config");
    let text: string;
    try {
      text = await fsp.readFile(cfg, "utf8");
    } catch {
      return null;
    }
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

export async function detectBranch(dir: string): Promise<string> {
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

type Counts = Record<TaskStatus, number> & { total: number; activeNonDone: number };

function emptyCounts(): Counts {
  const c = TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = 0;
      return acc;
    },
    {} as Record<TaskStatus, number>,
  ) as Counts;
  c.total = 0;
  c.activeNonDone = 0;
  return c;
}

/**
 * Aggregated task counts per project, computed in SQL to avoid loading every
 * task row into JS for the list view. Only non-archived tasks contribute to
 * the active counts and total (matches legacy `decorate()` behavior).
 */
function loadCountsByProject(): Map<string, Counts> {
  const db = getDb();
  const rows = db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      archived: tasks.archived,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .groupBy(tasks.projectId, tasks.status, tasks.archived)
    .all();

  const out = new Map<string, Counts>();
  for (const r of rows) {
    if (r.archived) continue;
    let c = out.get(r.projectId);
    if (!c) {
      c = emptyCounts();
      out.set(r.projectId, c);
    }
    const status = r.status as TaskStatus;
    const n = Number(r.count) || 0;
    c[status] = (c[status] ?? 0) + n;
    c.total += n;
    if (isActiveStatus(status) && status !== "finished") c.activeNonDone += n;
  }
  return out;
}

/**
 * Pull a preview snippet for each project's most-relevant active task
 * (running, else needs-input). Fetches just the columns we need for the
 * projects we're showing — not every task row.
 */
function loadPreviewByProject(projectIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (projectIds.length === 0) return out;
  const db = getDb();
  const rows = db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      preview: tasks.preview,
    })
    .from(tasks)
    .where(
      sql`${tasks.archived} = 0 AND ${tasks.status} IN ('running','needs-input') AND ${inArray(tasks.projectId, projectIds)}`,
    )
    .all();
  // running wins over needs-input
  for (const r of rows) {
    const existing = out.get(r.projectId);
    if (r.status === "running") {
      out.set(r.projectId, r.preview ?? null);
    } else if (!existing) {
      out.set(r.projectId, r.preview ?? null);
    }
  }
  return out;
}

export async function listProjects(): Promise<ProjectWithCounts[]> {
  const db = getDb();
  const rows = db.select().from(projects).orderBy(asc(projects.createdAt)).all();
  const countsByProject = loadCountsByProject();
  const previewByProject = loadPreviewByProject(rows.map((r) => r.id));
  return Promise.all(
    rows.map((p) =>
      decorateRow(p, countsByProject.get(p.id) ?? emptyCounts(), previewByProject.get(p.id) ?? null),
    ),
  );
}

export async function getProject(id: string): Promise<ProjectWithCounts | null> {
  const db = getDb();
  const p = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!p) return null;

  const countRows = db
    .select({
      status: tasks.status,
      archived: tasks.archived,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(eq(tasks.projectId, id))
    .groupBy(tasks.status, tasks.archived)
    .all();
  const counts = emptyCounts();
  for (const r of countRows) {
    if (r.archived) continue;
    const status = r.status as TaskStatus;
    const n = Number(r.count) || 0;
    counts[status] = (counts[status] ?? 0) + n;
    counts.total += n;
    if (isActiveStatus(status) && status !== "finished") counts.activeNonDone += n;
  }

  const previewRow = db
    .select({ status: tasks.status, preview: tasks.preview })
    .from(tasks)
    .where(
      sql`${tasks.projectId} = ${id} AND ${tasks.archived} = 0 AND ${tasks.status} IN ('running','needs-input')`,
    )
    .all();
  const previewSource =
    previewRow.find((t) => t.status === "running") ??
    previewRow.find((t) => t.status === "needs-input");
  return decorateRow(p, counts, previewSource?.preview ?? null);
}

/**
 * Sync, undecorated lookup for callers that only need the raw project row
 * (e.g. resolving a project's working directory) — avoids the async fs hop
 * detectGithubUrl now triggers.
 */
export function getProjectRow(id: string): Project | null {
  const db = getDb();
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

async function decorateRow(
  p: Project,
  taskCounts: Counts,
  preview: string | null,
): Promise<ProjectWithCounts> {
  return {
    ...p,
    taskCounts,
    preview,
    githubUrl: await detectGithubUrl(p.path),
  };
}

export async function createProject(input: {
  name?: string;
  path: string;
  icon?: string;
  iconColor?: string;
  groupId?: string | null;
}): Promise<Project> {
  if (!input.path?.trim()) throw new Error("Working directory is required");
  if (!fs.existsSync(input.path)) throw new Error("Working directory does not exist");
  const stat = fs.statSync(input.path);
  if (!stat.isDirectory()) throw new Error("Working directory must be a directory");

  const name = input.name?.trim() || path.basename(input.path) || "project";

  const db = getDb();

  if (!isProTier(readLicenseState())) {
    const existing = db.select({ id: projects.id }).from(projects).all();
    if (existing.length >= FREE_PROJECT_CAP) {
      throw new ProjectCapExceededError(FREE_PROJECT_CAP, existing.length);
    }
  }

  const now = Date.now();
  const id = newId("p");
  const branch = await detectBranch(input.path);
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
  db.insert(projects).values(row).run();
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
  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) return null;
  const { launchCommands, ...rest } = patch;
  const updated = {
    ...existing,
    ...rest,
    ...(launchCommands !== undefined
      ? { launchCommands: serializeLaunchCommands(launchCommands) }
      : {}),
    updatedAt: Date.now(),
  };
  db.update(projects).set(updated).where(eq(projects.id, id)).run();
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
  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) return null;
  const next = { ...existing, pinned: !existing.pinned, updatedAt: Date.now() };
  db.update(projects)
    .set({ pinned: next.pinned, updatedAt: next.updatedAt })
    .where(eq(projects.id, id))
    .run();
  events.emit("project:updated", { id });
  return next;
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const result = db.delete(projects).where(eq(projects.id, id)).run();
  if (result.changes > 0) deleteAllProjectImagesFor(id);
  events.emit("project:deleted", { id });
  return result.changes > 0;
}

export async function refreshBranch(id: string): Promise<string | null> {
  const db = getDb();
  const p = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!p) return null;
  const branch = await detectBranch(p.path);
  if (branch !== p.branch) {
    db.update(projects).set({ branch, updatedAt: Date.now() }).where(eq(projects.id, id)).run();
    events.emit("project:updated", { id });
  }
  return branch;
}
