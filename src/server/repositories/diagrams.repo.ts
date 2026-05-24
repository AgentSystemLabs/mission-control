import { asc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { taskDiagrams } from "~/db/schema";
import type { StoredDiagram } from "~/shared/diagram";

function toStoredDiagram(row: typeof taskDiagrams.$inferSelect): StoredDiagram {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    title: row.title,
    source: row.source,
    format: row.format,
    createdAt: row.createdAt,
  };
}

export function findDiagramsByTaskId(taskId: string): StoredDiagram[] {
  return getDb()
    .select()
    .from(taskDiagrams)
    .where(eq(taskDiagrams.taskId, taskId))
    .orderBy(asc(taskDiagrams.createdAt))
    .all()
    .map(toStoredDiagram);
}

export function findDiagramsByProjectId(projectId: string): StoredDiagram[] {
  return getDb()
    .select()
    .from(taskDiagrams)
    .where(eq(taskDiagrams.projectId, projectId))
    .orderBy(asc(taskDiagrams.createdAt))
    .all()
    .map(toStoredDiagram);
}

export function insertDiagramRow(diagram: StoredDiagram): StoredDiagram {
  const now = Date.now();
  getDb()
    .insert(taskDiagrams)
    .values({
      id: diagram.id,
      taskId: diagram.taskId,
      projectId: diagram.projectId,
      title: diagram.title,
      source: diagram.source,
      format: diagram.format,
      createdAt: diagram.createdAt,
      updatedAt: now,
    })
    .run();
  return diagram;
}

export function deleteDiagramsByTaskId(taskId: string): void {
  getDb().delete(taskDiagrams).where(eq(taskDiagrams.taskId, taskId)).run();
}

export function deleteAllDiagramsForTests(): void {
  getDb().delete(taskDiagrams).run();
}
