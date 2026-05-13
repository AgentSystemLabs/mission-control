import { eq, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { projects } from "~/db/schema";
import type { Project } from "~/db/schema";
import { events } from "../../events";

export function togglePin(id: string): Project | null {
  const db = getDb();
  const updated = db
    .update(projects)
    .set({ pinned: sql`NOT ${projects.pinned}`, updatedAt: Date.now() })
    .where(eq(projects.id, id))
    .returning()
    .get();
  if (!updated) return null;
  events.emit("project:updated", { id });
  return updated;
}
