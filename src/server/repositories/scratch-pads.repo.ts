import { desc, eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { scratchPads, type NewScratchPad, type ScratchPad } from "~/db/schema";

export function insertScratchPadRow(row: NewScratchPad): void {
  getDb().insert(scratchPads).values(row).run();
}

export function getScratchPadById(id: string): ScratchPad | null {
  return getDb().select().from(scratchPads).where(eq(scratchPads.id, id)).get() ?? null;
}

/** All scratch pads for a project, most recently touched first. */
export function listScratchPadsByProject(projectId: string): ScratchPad[] {
  return getDb()
    .select()
    .from(scratchPads)
    .where(eq(scratchPads.projectId, projectId))
    .orderBy(desc(scratchPads.updatedAt))
    .all();
}

export function updateScratchPadRow(
  id: string,
  patch: Partial<Omit<NewScratchPad, "id" | "projectId" | "createdAt">>,
): ScratchPad | null {
  getDb().update(scratchPads).set(patch).where(eq(scratchPads.id, id)).run();
  return getScratchPadById(id);
}

export function deleteScratchPadRow(id: string): void {
  getDb().delete(scratchPads).where(eq(scratchPads.id, id)).run();
}
