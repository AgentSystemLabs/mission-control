import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { Task } from "~/db/schema";
import { events } from "../events";
import { sendTelemetry } from "./telemetry";
import { getRepositories } from "../repositories";

export async function listTasksForProject(projectId: string): Promise<Task[]> {
  return getRepositories().tasks.listForProject(projectId);
}

export async function getTask(id: string): Promise<Task | null> {
  return getRepositories().tasks.get(id);
}

export async function createTask(input: {
  projectId: string;
  title: string;
  agent: TaskAgent;
  branch?: string;
  status?: TaskStatus;
  preview?: string;
  claudeSessionId?: string | null;
  claudeSkipPermissions?: boolean;
  claudeBareSession?: boolean;
}): Promise<Task> {
  const row = await getRepositories().tasks.create(input);
  events.emit("task:created", { id: row.id, projectId: row.projectId });
  sendTelemetry("session_started");
  return row;
}

export async function updateStatus(
  id: string,
  patch: { status?: TaskStatus; preview?: string; lines?: number }
): Promise<Task | null> {
  const result = await getRepositories().tasks.updateStatus(id, patch);
  if (!result) return null;
  const { task: updated, previousStatus, projectName } = result;
  events.emit("task:updated", { id, projectId: updated.projectId });
  if (patch.status === "finished" && previousStatus !== "finished") {
    events.emit("session:finished", {
      id,
      projectId: updated.projectId,
      projectName,
      taskTitle: updated.title,
    });
  }
  return updated;
}

export async function updateTask(
  id: string,
  patch: Partial<
    Pick<Task, "title" | "branch" | "claudeSessionId" | "claudeSkipPermissions" | "claudeBareSession">
  >
): Promise<Task | null> {
  const updated = await getRepositories().tasks.update(id, patch);
  if (!updated) return null;
  events.emit("task:updated", { id, projectId: updated.projectId });
  return updated;
}

export async function archiveTask(id: string): Promise<Task | null> {
  const updated = await getRepositories().tasks.archive(id);
  if (!updated) return null;
  events.emit("task:archived", { id, projectId: updated.projectId });
  return updated;
}

export async function restoreTask(id: string): Promise<Task | null> {
  const updated = await getRepositories().tasks.restore(id);
  if (!updated) return null;
  events.emit("task:restored", { id, projectId: updated.projectId });
  return updated;
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await getRepositories().tasks.delete(id);
  if (result.deleted && result.existing) {
    const existing = result.existing;
    events.emit("task:deleted", { id, projectId: existing.projectId });
    return true;
  }
  return false;
}

export async function appendTerminalLog(taskId: string, chunk: string): Promise<void> {
  await getRepositories().tasks.appendTerminalLog(taskId, chunk);
}

export async function readTerminalLog(taskId: string): Promise<string> {
  return getRepositories().tasks.readTerminalLog(taskId);
}
