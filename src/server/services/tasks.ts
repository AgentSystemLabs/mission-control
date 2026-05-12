import { and, asc, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb, getSqlite } from "~/db/client";
import { projects, tasks, terminalLogs } from "~/db/schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, isTaskAgent, isTaskStatus } from "~/shared/domain";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { Task } from "~/db/schema";
import { events } from "../events";
import { sendTelemetry } from "./telemetry";

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
  claudeSessionId?: string | null;
  claudeSkipPermissions?: boolean;
  claudeBareSession?: boolean;
}): Task {
  if (!input.projectId) throw new Error("projectId required");
  if (!input.title?.trim()) throw new Error("title required");
  if (!isTaskAgent(input.agent)) throw new Error("invalid agent");

  const db = getDb();
  const now = Date.now();
  const row: Task = {
    id: newId(),
    projectId: input.projectId,
    title: input.title.trim(),
    agent: input.agent,
    status: input.status ?? DEFAULT_TASK_STATUS,
    branch: input.branch || DEFAULT_BRANCH,
    preview: input.preview ?? "",
    lines: 0,
    archived: false,
    claudeSessionId: input.claudeSessionId ?? null,
    claudeSkipPermissions: input.claudeSkipPermissions ?? false,
    claudeBareSession: input.claudeBareSession ?? false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(tasks).values(row).run();
  events.emit("task:created", { id: row.id, projectId: row.projectId });
  sendTelemetry("session_started");
  return row;
}

export function updateStatus(
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number }
): Task | null {
  if (patch.status && !isTaskStatus(patch.status)) throw new Error("invalid status");
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
  if (
    patch.status === "finished" &&
    existing.status !== "finished"
  ) {
    const project = db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, existing.projectId))
      .get();
    events.emit("session:finished", {
      id,
      projectId: existing.projectId,
      projectName: project?.name ?? "Project",
      taskTitle: existing.title,
    });
  }
  return next;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<Task, "title" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">
  >
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

const RING_LIMIT_BYTES = 1_000_000;

export function appendTerminalLog(taskId: string, chunk: string) {
  getDb();
  const sqlite = getSqlite();
  const id = `tl-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const insert = sqlite.prepare(
    "INSERT INTO terminal_logs (id, task_id, chunk, created_at) VALUES (?, ?, ?, ?)"
  );
  const sumBytes = sqlite.prepare(
    "SELECT COALESCE(SUM(length(chunk)), 0) AS total, COUNT(*) AS n FROM terminal_logs WHERE task_id = ?"
  );
  const evict = sqlite.prepare(
    `DELETE FROM terminal_logs WHERE id IN (
       SELECT id FROM terminal_logs WHERE task_id = ?
       ORDER BY created_at ASC, id ASC LIMIT ?
     )`
  );

  const tx = sqlite.transaction((tid: string, c: string) => {
    insert.run(id, tid, c, Date.now());
    let stats = sumBytes.get(tid) as { total: number; n: number };
    // Bounded loop: estimate eviction count from average chunk size; re-check
    // after each batch since estimate may undershoot for skewed distributions.
    let guard = 0;
    while (stats.total > RING_LIMIT_BYTES && stats.n > 1 && guard < 8) {
      const oversize = stats.total - RING_LIMIT_BYTES;
      const avg = Math.max(1, Math.floor(stats.total / stats.n));
      const estimate = Math.min(
        stats.n - 1,
        Math.max(1, Math.ceil(oversize / avg))
      );
      evict.run(tid, estimate);
      stats = sumBytes.get(tid) as { total: number; n: number };
      guard++;
    }
  });
  tx(taskId, chunk);
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
