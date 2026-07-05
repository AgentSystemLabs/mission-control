import { and, asc, desc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "~/db/client";
import { projectMemory, type NewProjectMemory, type ProjectMemory } from "~/db/schema";

export function insertMemoryRow(row: NewProjectMemory): void {
  getDb().insert(projectMemory).values(row).run();
}

export function getMemoryById(id: string): ProjectMemory | null {
  return getDb().select().from(projectMemory).where(eq(projectMemory.id, id)).get() ?? null;
}

/** All memories for a project, newest first. Archived rows excluded by default. */
export function listMemoryByProject(
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): ProjectMemory[] {
  const where = opts.includeArchived
    ? eq(projectMemory.projectId, projectId)
    : and(eq(projectMemory.projectId, projectId), eq(projectMemory.status, "active"));
  return getDb()
    .select()
    .from(projectMemory)
    .where(where)
    .orderBy(desc(projectMemory.pinned), desc(projectMemory.updatedAt))
    .all();
}

/**
 * Active, non-superseded memories used to assemble the Session Brief. Ordered
 * pinned-first then by type weight is applied in the service (ranking), so here
 * we just return the candidate set for the project/scope.
 */
export function listBriefCandidates(projectId: string, scopeId: string): ProjectMemory[] {
  return getDb()
    .select()
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.status, "active"),
        // Only the head of a supersede chain (superseded_by_id IS NULL).
        sql`${projectMemory.supersededById} IS NULL`,
        or(eq(projectMemory.scopeId, scopeId), eq(projectMemory.scopeId, "local")),
      ),
    )
    .orderBy(desc(projectMemory.pinned), asc(projectMemory.type))
    .all();
}

export function updateMemoryRow(
  id: string,
  patch: Partial<Omit<NewProjectMemory, "id" | "projectId" | "createdAt">>,
): ProjectMemory | null {
  getDb().update(projectMemory).set(patch).where(eq(projectMemory.id, id)).run();
  return getMemoryById(id);
}

/** Hard delete (used by the panel's "delete"); soft-delete goes through updateMemoryRow(status). */
export function deleteMemoryRow(id: string): void {
  getDb().delete(projectMemory).where(eq(projectMemory.id, id)).run();
}

/**
 * Point an old memory at the new head that replaces it and archive it, in one
 * write. The new head must already be inserted (active, `supersededById` NULL)
 * so brief candidacy — which selects `status = 'active' AND superseded_by_id IS
 * NULL` — flips cleanly from the old row to the new one.
 */
export function supersedeMemoryRow(oldId: string, newHeadId: string, now: number): void {
  getDb()
    .update(projectMemory)
    .set({ status: "archived", supersededById: newHeadId, updatedAt: now })
    .where(eq(projectMemory.id, oldId))
    .run();
}

/** Increment usage + stamp last-used for memories included in a brief. */
export function bumpMemoryUsage(ids: readonly string[], now: number): void {
  if (!ids.length) return;
  getDb().transaction((tx) => {
    for (const id of ids) {
      tx.update(projectMemory)
        .set({ usageCount: sql`${projectMemory.usageCount} + 1`, lastUsedAt: now })
        .where(eq(projectMemory.id, id))
        .run();
    }
  });
}

// Escape SQLite LIKE wildcards so a user typing `%`, `_`, or `\` searches
// literally. Paired with an explicit `ESCAPE '\'` clause below.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function likeEscaped(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/**
 * Substring search over title/body/tags within a single project's active
 * memories. Case-insensitive for ASCII (SQLite LIKE), consistent with the
 * prompt-search palette.
 */
export function searchMemory({
  projectId,
  query,
  limit,
}: {
  projectId: string;
  query: string;
  limit: number;
}): ProjectMemory[] {
  const pattern = `%${escapeLike(query)}%`;
  const match = or(
    likeEscaped(projectMemory.title, pattern),
    likeEscaped(projectMemory.body, pattern),
    likeEscaped(projectMemory.tags, pattern),
  );
  return getDb()
    .select()
    .from(projectMemory)
    .where(and(eq(projectMemory.projectId, projectId), eq(projectMemory.status, "active"), match))
    .orderBy(desc(projectMemory.pinned), desc(projectMemory.updatedAt))
    .limit(limit)
    .all();
}

/**
 * Near-duplicate lookup for dedup-on-capture: an active memory of the same type
 * in the same project whose title matches (case-insensitive), excluding `exceptId`.
 */
export function findDuplicateByTitle(
  projectId: string,
  type: string,
  title: string,
  exceptId?: string,
): ProjectMemory | null {
  const base = and(
    eq(projectMemory.projectId, projectId),
    eq(projectMemory.status, "active"),
    eq(projectMemory.type, type as ProjectMemory["type"]),
    sql`lower(${projectMemory.title}) = lower(${title})`,
  );
  const where = exceptId ? and(base, ne(projectMemory.id, exceptId)) : base;
  return getDb().select().from(projectMemory).where(where).get() ?? null;
}
