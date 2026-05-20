import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { tasks } from "~/db/schema";
import type { Task } from "~/db/schema";

export function findAllTasks(): Task[] {
  return getDb().select().from(tasks).all();
}

export function findTasksByProjectId(projectId: string): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt))
    .all();
}

export function findTasksByProjectIdAndWorktreeId(
  projectId: string,
  worktreeId: string | null,
): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(
      worktreeId
        ? and(eq(tasks.projectId, projectId), eq(tasks.worktreeId, worktreeId))
        : and(eq(tasks.projectId, projectId), isNull(tasks.worktreeId))
    )
    .orderBy(desc(tasks.createdAt))
    .all();
}

export function findTaskById(id: string): Task | null {
  return getDb().select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
}

export function insertTask(row: Task): void {
  getDb().insert(tasks).values(row).run();
}

export function updateTaskRow(id: string, patch: Partial<Task>): void {
  getDb().update(tasks).set(patch).where(eq(tasks.id, id)).run();
}

export function deleteTaskRow(id: string): number {
  const result = getDb().delete(tasks).where(eq(tasks.id, id)).run();
  return result.changes;
}

export type TaskSessionRef = {
  taskId: string;
  projectId: string;
  claudeSessionId: string;
};

export function findTasksWithClaudeSessionId(): TaskSessionRef[] {
  const rows = getDb()
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      claudeSessionId: tasks.claudeSessionId,
    })
    .from(tasks)
    .where(sql`${tasks.claudeSessionId} IS NOT NULL`)
    .all();
  return rows.map((r) => ({
    taskId: r.taskId,
    projectId: r.projectId,
    claudeSessionId: r.claudeSessionId!,
  }));
}
