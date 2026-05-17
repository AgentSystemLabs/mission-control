import type { UserTerminal } from "~/db/schema";
import {
  deleteEphemeralUserTerminalsByProject,
  deleteUserTerminalRow,
  findUserTerminalById,
  findVisibleUserTerminalsByProject,
  insertUserTerminal,
  updateUserTerminalRow,
} from "../repositories/user-terminals.repo";
import { projectExists } from "../repositories/projects.repo";
import { newId } from "./_ids";

export function listUserTerminals(projectId: string): UserTerminal[] {
  // Ephemeral terminals (those with a startCommand) are seeded into the UI
  // by the project's launchCommands and are not meant to persist across reloads.
  deleteEphemeralUserTerminalsByProject(projectId);
  return findVisibleUserTerminalsByProject(projectId);
}

export function createUserTerminal(input: {
  projectId: string;
  name?: string;
  cwd?: string | null;
  startCommand?: string | null;
}): UserTerminal {
  if (!projectExists(input.projectId)) throw new Error("Project does not exist");

  const existing = listUserTerminals(input.projectId);
  const now = Date.now();
  const row: UserTerminal = {
    id: newId("ut"),
    projectId: input.projectId,
    name: (input.name?.trim() || `Terminal ${existing.length + 1}`),
    cwd: input.cwd ?? null,
    startCommand: input.startCommand?.trim() || null,
    position: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  if (row.startCommand) {
    return row;
  }
  insertUserTerminal(row);
  return row;
}

export function renameUserTerminal(id: string, name: string): UserTerminal | null {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const existing = findUserTerminalById(id);
  if (!existing) return null;
  const next = { ...existing, name: trimmed, updatedAt: Date.now() };
  updateUserTerminalRow(id, next);
  return next;
}

export function deleteUserTerminal(id: string): boolean {
  return deleteUserTerminalRow(id) > 0;
}
