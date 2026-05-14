import { and, asc, eq, ne, sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "~/db/client";
import { projects, tasks } from "~/db/schema";
import { LAUNCH_COMMANDS_MAX, isActiveStatus } from "~/shared/domain";
import type { LaunchCommand, TaskStatus } from "~/shared/domain";
import type { Project } from "~/db/schema";
import type { ProjectWithCounts } from "~/shared/projects";
import { FREE_PROJECT_CAP, isProTier } from "~/shared/license";
import { events } from "../../events";
import { readLicenseState } from "../license";
import { normalizeProjectImageDataUrl } from "../../lib/project-image-data";
import {
  DuplicateProjectPathError,
  ProjectCapExceededError,
  decorateRow,
  detectBranch,
  emptyCounts,
  isUniqueConstraintError,
  newId,
} from "./internal";
import { loadCountsByProject, loadPreviewByProject } from "./preview";

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

export async function createProject(input: {
  name?: string;
  path: string;
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
  if (!input.path?.trim()) throw new Error("Working directory is required");
  const runtimeKind = input.runtimeKind ?? "local";
  if (runtimeKind === "local") {
    if (!fs.existsSync(input.path)) throw new Error("Working directory does not exist");
    const stat = fs.statSync(input.path);
    if (!stat.isDirectory()) throw new Error("Working directory must be a directory");
  }

  const name = input.name?.trim() || path.basename(input.path) || "project";

  const db = getDb();

  const pro = isProTier(await readLicenseState());
  const now = Date.now();
  const id = newId("p");
  const branch = runtimeKind === "local" ? await detectBranch(input.path) : "main";
  const row = {
    id,
    name,
    path: input.path,
    icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
    iconColor: input.iconColor || "#ff5a1f",
    imagePath: null,
    imageDataUrl:
      input.imageDataUrl !== undefined
        ? normalizeProjectImageDataUrl(input.imageDataUrl)
        : null,
    groupId: input.groupId ?? null,
    pinned: false,
    branch,
    launchCommands: null,
    launchUrl: null,
    runtimeKind,
    ownerUserId: input.ownerUserId ?? null,
    sandboxId: input.sandboxId ?? null,
    workspacePath: input.workspacePath ?? input.path,
    repoUrl: input.repoUrl ?? null,
    sandboxState: input.sandboxState ?? null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    githubUrl: null,
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
  > & { launchCommands?: LaunchCommand[] | null }
): Project | null {
  const db = getDb();
  const { launchCommands, ...rest } = patch;
  const imageDataUrl =
    patch.imageDataUrl !== undefined
      ? normalizeProjectImageDataUrl(patch.imageDataUrl)
      : undefined;
  const imagePath = patch.imagePath === "" ? null : patch.imagePath;
  if (imagePath && imageDataUrl) {
    throw new Error("Choose either a local image path or image data URL");
  }
  const setPatch: Partial<Project> & { updatedAt: number } = {
    ...rest,
    ...(patch.imagePath !== undefined ? { imagePath } : {}),
    ...(patch.imageDataUrl !== undefined ? { imageDataUrl } : {}),
    ...(imageDataUrl ? { imagePath: null } : {}),
    ...(imagePath ? { imageDataUrl: null } : {}),
    ...(imagePath === null && patch.imageDataUrl === undefined
      ? { imageDataUrl: null }
      : {}),
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

export async function refreshBranch(id: string): Promise<string | null> {
  const db = getDb();
  const p = db
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  if (!p) return null;
  // fs I/O kept outside the DB write
  const branch = await detectBranch(p.path);
  const updated = db
    .update(projects)
    .set({ branch, updatedAt: Date.now() })
    .where(and(eq(projects.id, id), ne(projects.branch, branch)))
    .returning({ id: projects.id })
    .get();
  if (updated) events.emit("project:updated", { id });
  return branch;
}
