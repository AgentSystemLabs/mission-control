import { eq, asc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "~/db/client";
import { groups, projects } from "~/db/schema";
import type { Group } from "~/db/schema";
import { GROUP_COLORS } from "~/lib/design-meta";
import { events } from "../events";

function newId() {
  return `g-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listGroups(): Group[] {
  return getDb().select().from(groups).orderBy(asc(groups.createdAt)).all();
}

export function createGroup(input: { name: string; color?: string }): Group {
  if (!input.name?.trim()) throw new Error("Group name is required");
  const db = getDb();
  const existing = listGroups();
  const color = input.color || GROUP_COLORS[existing.length % GROUP_COLORS.length] || "#ff5a1f";
  const row: Group = {
    id: newId(),
    name: input.name.trim(),
    color,
    createdAt: Date.now(),
  };
  db.insert(groups).values(row).run();
  events.emit("group:created", { id: row.id });
  return row;
}

export function updateGroup(id: string, patch: Partial<Pick<Group, "name" | "color">>): Group | null {
  const db = getDb();
  const existing = db.select().from(groups).where(eq(groups.id, id)).get();
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.update(groups).set(next).where(eq(groups.id, id)).run();
  events.emit("group:updated", { id });
  return next;
}

export function deleteGroup(id: string): boolean {
  const db = getDb();
  // orphan projects to ungrouped
  db.update(projects).set({ groupId: null }).where(eq(projects.groupId, id)).run();
  const result = db.delete(groups).where(eq(groups.id, id)).run();
  events.emit("group:deleted", { id });
  return result.changes > 0;
}
