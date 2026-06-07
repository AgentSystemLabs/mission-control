import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "~/db/client";
import { userTerminals } from "~/db/schema";
import type { UserTerminal } from "~/db/schema";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";

export function findVisibleUserTerminalsByProject(
  projectId: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): UserTerminal[] {
  return getDb()
    .select()
    .from(userTerminals)
    .where(
      and(
        eq(userTerminals.projectId, projectId),
        eq(userTerminals.scopeId, normalizeScopeId(scopeId)),
        isNull(userTerminals.startCommand),
      ),
    )
    .orderBy(asc(userTerminals.position), asc(userTerminals.createdAt))
    .all();
}

export function findVisibleUserTerminalsByProjectAndWorktree(
  projectId: string,
  worktreeId: string | null,
  scopeId: string | null = LOCAL_SCOPE_ID,
): UserTerminal[] {
  const scope = normalizeScopeId(scopeId);
  return getDb()
    .select()
    .from(userTerminals)
    .where(
      and(
        eq(userTerminals.projectId, projectId),
        worktreeId ? eq(userTerminals.worktreeId, worktreeId) : isNull(userTerminals.worktreeId),
        eq(userTerminals.scopeId, scope),
        isNull(userTerminals.startCommand),
      )
    )
    .orderBy(asc(userTerminals.position), asc(userTerminals.createdAt))
    .all();
}

export function deleteEphemeralUserTerminalsByProject(
  projectId: string,
  scopeId: string | null = LOCAL_SCOPE_ID,
): void {
  getDb()
    .delete(userTerminals)
    .where(
      and(
        eq(userTerminals.projectId, projectId),
        eq(userTerminals.scopeId, normalizeScopeId(scopeId)),
        isNotNull(userTerminals.startCommand),
      ),
    )
    .run();
}

export function deleteEphemeralUserTerminalsByProjectAndWorktree(
  projectId: string,
  worktreeId: string | null,
  scopeId: string | null = LOCAL_SCOPE_ID,
): void {
  const scope = normalizeScopeId(scopeId);
  getDb()
    .delete(userTerminals)
    .where(
      and(
        eq(userTerminals.projectId, projectId),
        worktreeId ? eq(userTerminals.worktreeId, worktreeId) : isNull(userTerminals.worktreeId),
        eq(userTerminals.scopeId, scope),
        isNotNull(userTerminals.startCommand),
      )
    )
    .run();
}

export function findUserTerminalById(id: string): UserTerminal | null {
  return getDb().select().from(userTerminals).where(eq(userTerminals.id, id)).get() ?? null;
}

export function insertUserTerminal(row: UserTerminal): void {
  getDb().insert(userTerminals).values(row).run();
}

export function updateUserTerminalRow(id: string, patch: Partial<UserTerminal>): void {
  getDb().update(userTerminals).set(patch).where(eq(userTerminals.id, id)).run();
}

export function deleteUserTerminalRow(id: string): number {
  const result = getDb().delete(userTerminals).where(eq(userTerminals.id, id)).run();
  return result.changes;
}

export function deleteUserTerminalsByScope(scopeId: string): number {
  return getDb()
    .delete(userTerminals)
    .where(eq(userTerminals.scopeId, normalizeScopeId(scopeId)))
    .run().changes;
}
