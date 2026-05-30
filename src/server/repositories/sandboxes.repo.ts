import { eq, asc } from "drizzle-orm";
import { getDb } from "~/db/client";
import { sandboxes } from "~/db/schema";
import type { Sandbox, NewSandbox } from "~/db/schema";

export function findAllSandboxes(): Sandbox[] {
  return getDb().select().from(sandboxes).orderBy(asc(sandboxes.createdAt)).all();
}

export function findSandboxById(id: string): Sandbox | null {
  return getDb().select().from(sandboxes).where(eq(sandboxes.id, id)).get() ?? null;
}

export function insertSandbox(row: NewSandbox): void {
  getDb().insert(sandboxes).values(row).run();
}

export function updateSandboxRow(id: string, patch: Partial<Sandbox>): void {
  getDb().update(sandboxes).set(patch).where(eq(sandboxes.id, id)).run();
}

/** Deletes the sandbox row; ON DELETE CASCADE removes its projects (and their
 *  tasks/worktrees). Returns the number of sandbox rows removed. */
export function deleteSandboxRow(id: string): number {
  return getDb().delete(sandboxes).where(eq(sandboxes.id, id)).run().changes;
}
