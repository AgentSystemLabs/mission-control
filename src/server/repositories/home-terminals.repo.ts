import { asc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { homeTerminals } from "~/db/schema";
import type { HomeTerminal, UserTerminal } from "~/db/schema";
import { HOME_TERMINAL_PROJECT_ID } from "~/shared/home-terminal";

/**
 * Shape a `home_terminals` row as a `UserTerminal` so the renderer can render it
 * with the existing terminal components. projectId is a sentinel; worktreeId and
 * startCommand are always null for home terminals (they are never launch/ephemeral).
 */
export function toUserTerminal(row: HomeTerminal): UserTerminal {
  return {
    id: row.id,
    projectId: HOME_TERMINAL_PROJECT_ID,
    worktreeId: null,
    name: row.name,
    cwd: row.cwd,
    startCommand: null,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function findHomeTerminalsByScope(scopeId: string): HomeTerminal[] {
  return getDb()
    .select()
    .from(homeTerminals)
    .where(eq(homeTerminals.scopeId, scopeId))
    .orderBy(asc(homeTerminals.position), asc(homeTerminals.createdAt))
    .all();
}

export function findHomeTerminalById(id: string): HomeTerminal | null {
  return getDb().select().from(homeTerminals).where(eq(homeTerminals.id, id)).get() ?? null;
}

export function insertHomeTerminal(row: HomeTerminal): void {
  getDb().insert(homeTerminals).values(row).run();
}

export function updateHomeTerminalRow(id: string, patch: Partial<HomeTerminal>): void {
  getDb().update(homeTerminals).set(patch).where(eq(homeTerminals.id, id)).run();
}

export function deleteHomeTerminalRow(id: string): number {
  return getDb().delete(homeTerminals).where(eq(homeTerminals.id, id)).run().changes;
}
