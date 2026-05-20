import { asc, and, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { worktrees } from "~/db/schema";
import type { Worktree } from "~/db/schema";

export function findWorktreesByProjectId(projectId: string): Worktree[] {
  return getDb()
    .select()
    .from(worktrees)
    .where(eq(worktrees.projectId, projectId))
    .orderBy(asc(worktrees.createdAt))
    .all();
}

export function findWorktreeById(id: string): Worktree | null {
  return getDb().select().from(worktrees).where(eq(worktrees.id, id)).get() ?? null;
}

export function findWorktreeByProjectAndName(
  projectId: string,
  name: string,
): Worktree | null {
  return getDb()
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.projectId, projectId), eq(worktrees.name, name)))
    .get() ?? null;
}

export function insertWorktree(row: Worktree): void {
  getDb().insert(worktrees).values(row).run();
}

export function deleteWorktreeRow(id: string): number {
  const result = getDb().delete(worktrees).where(eq(worktrees.id, id)).run();
  return result.changes;
}
