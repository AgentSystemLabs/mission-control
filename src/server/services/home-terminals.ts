import type { HomeTerminal, UserTerminal } from "~/db/schema";
import {
  deleteHomeTerminalRow,
  findHomeTerminalById,
  findHomeTerminalsByScope,
  insertHomeTerminal,
  toUserTerminal,
  updateHomeTerminalRow,
} from "../repositories/home-terminals.repo";
import { isClientDomainId } from "~/shared/client-id";
import { normalizeScopeId } from "~/shared/sandbox";
import { newId } from "./_ids";

const DEFAULT_TERMINAL_NAME_RE = /^Terminal (\d+)$/;

/** Pick the lowest unused "Terminal N" name within one scope. */
function nextDefaultHomeTerminalName(rows: HomeTerminal[]): string {
  const used = new Set<number>();
  for (const t of rows) {
    const match = DEFAULT_TERMINAL_NAME_RE.exec(t.name);
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Terminal ${n}`;
}

export function listHomeTerminals(scopeId?: string | null): UserTerminal[] {
  return findHomeTerminalsByScope(normalizeScopeId(scopeId)).map(toUserTerminal);
}

export function createHomeTerminal(input: {
  id?: string;
  name?: string;
  cwd?: string | null;
  scopeId?: string | null;
}): UserTerminal {
  const scopeId = normalizeScopeId(input.scopeId);
  const existing = findHomeTerminalsByScope(scopeId);
  const now = Date.now();
  const requestedId = input.id?.trim();
  if (requestedId && !isClientDomainId(requestedId)) throw new Error("invalid terminal id");
  if (requestedId && findHomeTerminalById(requestedId)) throw new Error("terminal id already exists");
  const row: HomeTerminal = {
    id: requestedId || newId("ht"),
    scopeId,
    name: input.name?.trim() || nextDefaultHomeTerminalName(existing),
    cwd: input.cwd ?? null,
    position: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  insertHomeTerminal(row);
  return toUserTerminal(row);
}

export function renameHomeTerminal(id: string, name: string): UserTerminal | null {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const existing = findHomeTerminalById(id);
  if (!existing) return null;
  const next: HomeTerminal = { ...existing, name: trimmed, updatedAt: Date.now() };
  updateHomeTerminalRow(id, next);
  return toUserTerminal(next);
}

export function deleteHomeTerminal(id: string): boolean {
  return deleteHomeTerminalRow(id) > 0;
}
