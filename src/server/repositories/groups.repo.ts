import { asc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { groups } from "~/db/schema";
import type { Group } from "~/db/schema";

export function findAllGroups(): Group[] {
  return getDb().select().from(groups).orderBy(asc(groups.createdAt)).all();
}

export function findGroupById(id: string): Group | null {
  return getDb().select().from(groups).where(eq(groups.id, id)).get() ?? null;
}

export function insertGroup(row: Group): void {
  getDb().insert(groups).values(row).run();
}

export function updateGroupRow(id: string, patch: Partial<Group>): void {
  getDb().update(groups).set(patch).where(eq(groups.id, id)).run();
}

export function deleteGroupRow(id: string): number {
  const result = getDb().delete(groups).where(eq(groups.id, id)).run();
  return result.changes;
}
