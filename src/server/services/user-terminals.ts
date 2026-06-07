import type { UserTerminal } from "~/db/schema";
import {
  deleteEphemeralUserTerminalsByProject,
  deleteEphemeralUserTerminalsByProjectAndWorktree,
  deleteUserTerminalRow,
  findUserTerminalById,
  findVisibleUserTerminalsByProject,
  findVisibleUserTerminalsByProjectAndWorktree,
  insertUserTerminal,
  updateUserTerminalRow,
} from "../repositories/user-terminals.repo";
import { isClientDomainId } from "~/shared/client-id";
import { projectExists } from "../repositories/projects.repo";
import { newId } from "./_ids";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { normalizeProjectScopeId } from "./sandbox-scope";

const DEFAULT_TERMINAL_NAME_RE = /^Terminal (\d+)$/;

/** Pick the lowest unused "Terminal N" name across the whole project. */
export function nextDefaultTerminalName(
  projectId: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): string {
  const normalizedScopeId = normalizeProjectScopeId(projectId, scopeId);
  const usedNumbers = new Set<number>();
  for (const terminal of findVisibleUserTerminalsByProject(projectId, normalizedScopeId)) {
    const match = DEFAULT_TERMINAL_NAME_RE.exec(terminal.name);
    if (match) usedNumbers.add(Number(match[1]));
  }
  let n = 1;
  while (usedNumbers.has(n)) n++;
  return `Terminal ${n}`;
}

export function listUserTerminals(
  projectId: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): UserTerminal[] {
  const normalizedScopeId = normalizeProjectScopeId(projectId, scopeId);
  // Ephemeral terminals (those with a startCommand) are seeded into the UI
  // by the project's launchCommands and are not meant to persist across reloads.
  deleteEphemeralUserTerminalsByProject(projectId, normalizedScopeId);
  return findVisibleUserTerminalsByProject(projectId, normalizedScopeId);
}

export function listUserTerminalsForWorktree(
  projectId: string,
  worktreeId: string | null,
  scopeId: string | null = LOCAL_SCOPE_ID,
): UserTerminal[] {
  const normalizedScopeId = normalizeProjectScopeId(projectId, scopeId);
  deleteEphemeralUserTerminalsByProjectAndWorktree(projectId, worktreeId, normalizedScopeId);
  return findVisibleUserTerminalsByProjectAndWorktree(projectId, worktreeId, normalizedScopeId);
}

export function createUserTerminal(input: {
  id?: string;
  projectId: string;
  worktreeId?: string | null;
  scopeId?: string | null;
  name?: string;
  cwd?: string | null;
  startCommand?: string | null;
}): UserTerminal {
  if (!projectExists(input.projectId)) throw new Error("Project does not exist");
  const scopeId = normalizeProjectScopeId(input.projectId, input.scopeId);

  const existing =
    input.worktreeId === undefined
      ? listUserTerminals(input.projectId, scopeId)
      : listUserTerminalsForWorktree(input.projectId, input.worktreeId, scopeId);
  const now = Date.now();
  const requestedId = input.id?.trim();
  if (requestedId && !isClientDomainId(requestedId)) throw new Error("invalid terminal id");
  if (requestedId && findUserTerminalById(requestedId)) throw new Error("terminal id already exists");
  const row: UserTerminal = {
    id: requestedId || newId("ut"),
    projectId: input.projectId,
    worktreeId: input.worktreeId ?? null,
    scopeId,
    name: input.name?.trim() || nextDefaultTerminalName(input.projectId, scopeId),
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
