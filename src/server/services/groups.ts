import { eq, asc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "~/db/client";
import { groups, projects } from "~/db/schema";
import type { Group } from "~/db/schema";
import { BRAND_PALETTE } from "~/lib/design-meta";
import { events } from "../events";

function newId() {
  return `g-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export class DuplicateGroupNameError extends Error {
  constructor(public readonly name: string) {
    super(`A group named "${name}" already exists.`);
    this.name = "DuplicateGroupNameError";
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    (typeof e.message === "string" && /UNIQUE constraint failed/i.test(e.message))
  );
}

export function listGroups(): Group[] {
  return getDb().select().from(groups).orderBy(asc(groups.createdAt)).all();
}

export function createGroup(input: { name: string; color?: string }): Group {
  if (!input.name?.trim()) throw new Error("Group name is required");
  const db = getDb();
  const existing = listGroups();
  const color = input.color || BRAND_PALETTE[existing.length % BRAND_PALETTE.length] || "#ff5a1f";
  const row: Group = {
    id: newId(),
    name: input.name.trim(),
    color,
    createdAt: Date.now(),
  };
  try {
    db.insert(groups).values(row).run();
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new DuplicateGroupNameError(row.name);
    throw err;
  }
  events.emit("group:created", { id: row.id });
  return row;
}

export function updateGroup(id: string, patch: Partial<Pick<Group, "name" | "color">>): Group | null {
  const db = getDb();
  const existing = db.select().from(groups).where(eq(groups.id, id)).get();
  if (!existing) return null;
  const next = { ...existing, ...patch };
  try {
    db.update(groups).set(next).where(eq(groups.id, id)).run();
  } catch (err) {
    if (isUniqueConstraintError(err) && patch.name !== undefined) {
      throw new DuplicateGroupNameError(String(patch.name));
    }
    throw err;
  }
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
