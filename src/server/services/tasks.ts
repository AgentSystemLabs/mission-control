import { and, asc, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "~/db/client";
import { TASK_AGENTS, TASK_STATUSES, tasks, terminalLogs } from "~/db/schema";
import type { Task, TaskAgent, TaskStatus } from "~/db/schema";
import { events } from "../events";

function newId() {
  return `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listTasksForProject(projectId: string): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
    .all();
}

export function getTask(id: string): Task | null {
  return getDb().select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
}

export function createTask(input: {
  projectId: string;
  title: string;
  agent: TaskAgent;
  branch?: string;
  status?: TaskStatus;
  preview?: string;
}): Task {
  if (!input.projectId) throw new Error("projectId required");
  if (!input.title?.trim()) throw new Error("title required");
  if (!(TASK_AGENTS as readonly TaskAgent[]).includes(input.agent)) throw new Error("invalid agent");

  const db = getDb();
  const now = Date.now();
  const row: Task = {
    id: newId(),
    projectId: input.projectId,
    title: input.title.trim(),
    agent: input.agent,
    status: input.status ?? "ready",
    branch: input.branch || "main",
    preview: input.preview ?? "",
    lines: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(tasks).values(row).run();
  events.emit("task:created", { id: row.id, projectId: row.projectId });
  return row;
}

export function updateStatus(
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number }
): Task | null {
  if (patch.status && !(TASK_STATUSES as readonly TaskStatus[]).includes(patch.status))
    throw new Error("invalid status");
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;
  const next = {
    ...existing,
    status: patch.status ?? existing.status,
    preview: patch.preview ?? existing.preview,
    lines: patch.lines ?? existing.lines,
    updatedAt: Date.now(),
  };
  db.update(tasks)
    .set({
      status: next.status,
      preview: next.preview,
      lines: next.lines,
      updatedAt: next.updatedAt,
    })
    .where(eq(tasks.id, id))
    .run();
  events.emit("task:updated", { id, projectId: existing.projectId });
  return next;
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "branch">>
): Task | null {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  db.update(tasks).set(next).where(eq(tasks.id, id)).run();
  events.emit("task:updated", { id, projectId: existing.projectId });
  return next;
}

export function archiveTask(id: string): Task | null {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;
  db.update(tasks)
    .set({ archived: true, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .run();
  const next = { ...existing, archived: true } as Task;
  events.emit("task:archived", { id, projectId: existing.projectId });
  return next;
}

export function restoreTask(id: string): Task | null {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;
  db.update(tasks)
    .set({ archived: false, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .run();
  const next = { ...existing, archived: false } as Task;
  events.emit("task:restored", { id, projectId: existing.projectId });
  return next;
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return false;
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes > 0) {
    events.emit("task:deleted", { id, projectId: existing.projectId });
    return true;
  }
  return false;
}

export function listAllArchived(): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.archived, true))
    .orderBy(desc(tasks.updatedAt))
    .all();
}

const RING_LIMIT_BYTES = 1_000_000;

export function appendTerminalLog(taskId: string, chunk: string) {
  const db = getDb();
  const id = `tl-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  db.insert(terminalLogs)
    .values({ id, taskId, chunk, createdAt: Date.now() })
    .run();
  // rough FIFO eviction by total length per task
  const all = db
    .select()
    .from(terminalLogs)
    .where(eq(terminalLogs.taskId, taskId))
    .orderBy(asc(terminalLogs.createdAt))
    .all();
  let total = all.reduce((a, r) => a + r.chunk.length, 0);
  for (const r of all) {
    if (total <= RING_LIMIT_BYTES) break;
    db.delete(terminalLogs).where(eq(terminalLogs.id, r.id)).run();
    total -= r.chunk.length;
  }
}

export function readTerminalLog(taskId: string): string {
  const all = getDb()
    .select()
    .from(terminalLogs)
    .where(eq(terminalLogs.taskId, taskId))
    .orderBy(asc(terminalLogs.createdAt))
    .all();
  return all.map((r) => r.chunk).join("");
}
