import { eq, asc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDb } from "~/db/client";
import { TASK_STATUSES, isActiveStatus, projects, tasks } from "~/db/schema";
import type { Project, Task, TaskStatus } from "~/db/schema";
import { events } from "../events";

export type ProjectWithCounts = Project & {
  taskCounts: Record<TaskStatus, number> & { total: number; activeNonDone: number };
  preview?: string | null;
};

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function detectBranch(dir: string): string {
  try {
    const headFile = path.join(dir, ".git", "HEAD");
    if (!fs.existsSync(headFile)) return "main";
    const content = fs.readFileSync(headFile, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) return content.replace("ref: refs/heads/", "");
    return content.slice(0, 7);
  } catch {
    return "main";
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
    if (isActiveStatus(t.status) && t.status !== "done") activeNonDone++;
  }
  const previewSource =
    active.find((t) => t.status === "running") ?? active.find((t) => t.status === "needs-input");
  return {
    ...p,
    taskCounts: { ...counts, total: active.length, activeNonDone },
    preview: previewSource?.preview ?? null,
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
  const now = Date.now();
  const id = newId("p");
  const branch = detectBranch(input.path);
  const row = {
    id,
    name,
    path: input.path,
    icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
    iconColor: input.iconColor || "#7ce58a",
    groupId: input.groupId ?? null,
    pinned: false,
    branch,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(projects).values(row).run();
  events.emit("project:created", { id });
  return row;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "path" | "icon" | "iconColor" | "groupId" | "pinned" | "branch">>
): Project | null {
  const db = getDb();
  const existing = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!existing) return null;
  const updated = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  db.update(projects).set(updated).where(eq(projects.id, id)).run();
  events.emit("project:updated", { id });
  return updated;
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
  events.emit("project:deleted", { id });
  return result.changes > 0;
}

export function refreshBranch(id: string): string | null {
  const db = getDb();
  const p = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!p) return null;
  const branch = detectBranch(p.path);
  if (branch !== p.branch) {
    db.update(projects).set({ branch, updatedAt: Date.now() }).where(eq(projects.id, id)).run();
    events.emit("project:updated", { id });
  }
  return branch;
}
