import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { groups } from "~/db/schema";
import type { Group } from "~/db/schema";

export function findAllGroups(): Group[] {
  // Manual order first; legacy rows with a NULL sort_order fall to the end in
  // creation order until the user reorders (which backfills every row).
  return getDb()
    .select()
    .from(groups)
    .orderBy(sql`${groups.sortOrder} is null`, asc(groups.sortOrder), asc(groups.createdAt))
    .all();
}

export function findGroupById(id: string): Group | null {
  return getDb().select().from(groups).where(eq(groups.id, id)).get() ?? null;
}

/** Highest assigned sort_order, or -1 when no group has one yet. */
export function maxGroupSortOrder(): number {
  const row = getDb()
    .select({ max: sql<number | null>`max(${groups.sortOrder})` })
    .from(groups)
    .get();
  return row?.max ?? -1;
}

export function insertGroup(row: Group): void {
  getDb().insert(groups).values(row).run();
}

export function updateGroupRow(id: string, patch: Partial<Group>): void {
  getDb().update(groups).set(patch).where(eq(groups.id, id)).run();
}

export function updateGroupSortOrder(id: string, sortOrder: number): void {
  getDb().update(groups).set({ sortOrder }).where(eq(groups.id, id)).run();
}

export function deleteGroupRow(id: string): number {
  const result = getDb().delete(groups).where(eq(groups.id, id)).run();
  return result.changes;
}
