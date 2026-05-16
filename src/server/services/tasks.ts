import { and, asc, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "~/db/client";
import { projects, tasks, terminalLogs } from "~/db/schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, isTaskAgent, isTaskStatus } from "~/shared/domain";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { Task } from "~/db/schema";
import { events } from "../events";
import { sendTelemetry } from "./telemetry";
import { appLogger } from "./logger";

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
    icon: null,
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
  appLogger.event("session", "Session created", {
    taskId: row.id,
    projectId: row.projectId,
    agent: row.agent,
    branch: row.branch,
    hasClaudeSessionId: !!row.claudeSessionId,
  });
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
    appLogger.success("session", "Session finished", {
      taskId: id,
      projectId: existing.projectId,
    });
  }
  return next;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<Task, "title" | "icon" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">
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
