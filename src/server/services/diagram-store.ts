import { randomUUID } from "node:crypto";
import type { StoredDiagram } from "~/shared/diagram";
import {
  deleteAllDiagramsForTests,
  deleteDiagramByTaskId,
  findDiagramByTaskId,
  findDiagramsByProjectId,
  upsertDiagramRow,
} from "../repositories/diagrams.repo";

export function getDiagramForTask(taskId: string): StoredDiagram | null {
  return findDiagramByTaskId(taskId);
}

export function listDiagramsForProject(projectId: string): StoredDiagram[] {
  return findDiagramsByProjectId(projectId);
}

export function upsertDiagramForTask(
  input: Omit<StoredDiagram, "id">,
): StoredDiagram {
  const diagram: StoredDiagram = {
    ...input,
    id: randomUUID(),
  };
  upsertDiagramRow(diagram);
  return diagram;
}

export function deleteDiagramForTask(taskId: string): void {
  deleteDiagramByTaskId(taskId);
}

export function resetDiagramStoreForTests(): void {
  deleteAllDiagramsForTests();
}
