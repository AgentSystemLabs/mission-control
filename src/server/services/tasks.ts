import { randomBytes } from "node:crypto";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, isTaskAgent, isTaskStatus } from "~/shared/domain";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { Task } from "~/db/schema";
import { events } from "../events";
import {
  deleteTaskRow,
  findTaskById,
  findTasksByProjectId,
  insertTask,
  updateTaskRow,
} from "../repositories/tasks.repo";
import { findProjectNameById } from "../repositories/projects.repo";
import {
  deleteTerminalLogById,
  findTerminalLogsByTaskId,
  insertTerminalLog,
} from "../repositories/terminal-logs.repo";
import { sendTelemetry } from "./telemetry";

function newId() {
  return `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listTasksForProject(projectId: string): Task[] {
  return findTasksByProjectId(projectId);
}

export function getTask(id: string): Task | null {
  return findTaskById(id);
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
  insertTask(row);
  events.emit("task:created", { id: row.id, projectId: row.projectId });
  sendTelemetry("session_started");
  return row;
}

export function updateStatus(
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number }
): Task | null {
  if (patch.status && !isTaskStatus(patch.status)) throw new Error("invalid status");
  const existing = findTaskById(id);
  if (!existing) return null;
  const next = {
    ...existing,
    status: patch.status ?? existing.status,
    preview: patch.preview ?? existing.preview,
    lines: patch.lines ?? existing.lines,
    updatedAt: Date.now(),
  };
  updateTaskRow(id, {
    status: next.status,
    preview: next.preview,
    lines: next.lines,
    updatedAt: next.updatedAt,
  });
  events.emit("task:updated", { id, projectId: existing.projectId });
  if (
    patch.status === "finished" &&
    existing.status !== "finished"
  ) {
    const projectName = findProjectNameById(existing.projectId);
    events.emit("session:finished", {
      id,
      projectId: existing.projectId,
      projectName: projectName ?? "Project",
      taskTitle: existing.title,
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
  const existing = findTaskById(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  updateTaskRow(id, next);
  events.emit("task:updated", { id, projectId: existing.projectId });
  return next;
}

export function archiveTask(id: string): Task | null {
  const existing = findTaskById(id);
  if (!existing) return null;
  updateTaskRow(id, { archived: true, updatedAt: Date.now() });
  const next = { ...existing, archived: true } as Task;
  events.emit("task:archived", { id, projectId: existing.projectId });
  return next;
}

export function restoreTask(id: string): Task | null {
  const existing = findTaskById(id);
  if (!existing) return null;
  updateTaskRow(id, { archived: false, updatedAt: Date.now() });
  const next = { ...existing, archived: false } as Task;
  events.emit("task:restored", { id, projectId: existing.projectId });
  return next;
}

export function deleteTask(id: string): boolean {
  const existing = findTaskById(id);
  if (!existing) return false;
  const changes = deleteTaskRow(id);
  if (changes > 0) {
    events.emit("task:deleted", { id, projectId: existing.projectId });
    return true;
  }
  return false;
}

const RING_LIMIT_BYTES = 1_000_000;

export function appendTerminalLog(taskId: string, chunk: string) {
  const id = `tl-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  insertTerminalLog({ id, taskId, chunk, createdAt: Date.now() });
  // rough FIFO eviction by total length per task
  const all = findTerminalLogsByTaskId(taskId);
  let total = all.reduce((a, r) => a + r.chunk.length, 0);
  for (const r of all) {
    if (total <= RING_LIMIT_BYTES) break;
    deleteTerminalLogById(r.id);
    total -= r.chunk.length;
  }
}

export function readTerminalLog(taskId: string): string {
  return findTerminalLogsByTaskId(taskId)
    .map((r) => r.chunk)
    .join("");
}
