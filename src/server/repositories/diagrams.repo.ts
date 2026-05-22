import { eq } from "drizzle-orm";
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
  };
}

export function findDiagramByTaskId(taskId: string): StoredDiagram | null {
  const row = getDb()
    .select()
    .from(taskDiagrams)
    .where(eq(taskDiagrams.taskId, taskId))
    .get();
  return row ? toStoredDiagram(row) : null;
}

export function findDiagramsByProjectId(projectId: string): StoredDiagram[] {
  return getDb()
    .select()
    .from(taskDiagrams)
    .where(eq(taskDiagrams.projectId, projectId))
    .all()
    .map(toStoredDiagram);
}

export function upsertDiagramRow(diagram: StoredDiagram): StoredDiagram {
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
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskDiagrams.taskId,
      set: {
        id: diagram.id,
        projectId: diagram.projectId,
        title: diagram.title,
        source: diagram.source,
        format: diagram.format,
        updatedAt: now,
      },
    })
    .run();
  return diagram;
}

export function deleteDiagramByTaskId(taskId: string): void {
  getDb().delete(taskDiagrams).where(eq(taskDiagrams.taskId, taskId)).run();
}

export function deleteAllDiagramsForTests(): void {
  getDb().delete(taskDiagrams).run();
}
