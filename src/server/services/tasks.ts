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
  const setPatch: Partial<Task> & { updatedAt: number } = { updatedAt: Date.now() };
  if (patch.status !== undefined) setPatch.status = patch.status;
  if (patch.preview !== undefined) setPatch.preview = patch.preview;
  if (patch.lines !== undefined) setPatch.lines = patch.lines;

  // Atomically capture the pre-image status and apply the partial update so a
  // concurrent updateStatus call can't race with us on the finished-transition
  // check.
  const result = getSqlite().transaction(() => {
    const prev = db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();
    if (!prev) return null;
    const row = db
      .update(tasks)
      .set(setPatch)
      .where(eq(tasks.id, id))
      .returning()
      .get();
    return row ? { row, prevStatus: prev.status } : null;
  })();
  if (!result) return null;
  const { row: updated, prevStatus } = result;
  events.emit("task:updated", { id, projectId: updated.projectId });
  if (patch.status === "finished" && prevStatus !== "finished") {
    const project = db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, updated.projectId))
      .get();
    events.emit("session:finished", {
      id,
      projectId: updated.projectId,
      projectName: project?.name ?? "Project",
      taskTitle: updated.title,
    });
  }
  return updated;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<Task, "title" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">
  >
): Task | null {
  const db = getDb();
  const updated = db
    .update(tasks)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("task:updated", { id, projectId: updated.projectId });
  return updated;
}

export function archiveTask(id: string): Task | null {
  const db = getDb();
  const updated = db
    .update(tasks)
    .set({ archived: true, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("task:archived", { id, projectId: updated.projectId });
  return updated;
}

export function restoreTask(id: string): Task | null {
  const db = getDb();
  const updated = db
    .update(tasks)
    .set({ archived: false, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("task:restored", { id, projectId: updated.projectId });
  return updated;
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
