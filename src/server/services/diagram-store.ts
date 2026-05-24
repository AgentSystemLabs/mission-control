import { randomUUID } from "node:crypto";
import type { StoredDiagram } from "~/shared/diagram";
import {
  deleteAllDiagramsForTests,
  deleteDiagramsByTaskId,
  findDiagramsByProjectId,
  findDiagramsByTaskId,
  insertDiagramRow,
} from "../repositories/diagrams.repo";

export function listDiagramsForTask(taskId: string): StoredDiagram[] {
  return findDiagramsByTaskId(taskId);
}

export function listDiagramsForProject(projectId: string): StoredDiagram[] {
  return findDiagramsByProjectId(projectId);
}

export function appendDiagramForTask(
  input: Omit<StoredDiagram, "id" | "createdAt">,
): StoredDiagram {
  const diagram: StoredDiagram = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  insertDiagramRow(diagram);
  return diagram;
}

export function deleteDiagramsForTask(taskId: string): void {
  deleteDiagramsByTaskId(taskId);
}

export function resetDiagramStoreForTests(): void {
  deleteAllDiagramsForTests();
}
