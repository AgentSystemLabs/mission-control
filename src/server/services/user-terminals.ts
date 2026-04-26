import { eq, asc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "~/db/client";
import { userTerminals } from "~/db/schema";
import type { UserTerminal } from "~/db/schema";

function newId() {
  return `ut-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listUserTerminals(projectId: string): UserTerminal[] {
  return getDb()
    .select()
    .from(userTerminals)
    .where(eq(userTerminals.projectId, projectId))
    .orderBy(asc(userTerminals.position), asc(userTerminals.createdAt))
    .all();
}

export function createUserTerminal(input: {
  projectId: string;
  name?: string;
  cwd?: string | null;
}): UserTerminal {
  const db = getDb();
  const existing = listUserTerminals(input.projectId);
  const now = Date.now();
  const row: UserTerminal = {
    id: newId(),
    projectId: input.projectId,
    name: (input.name?.trim() || `Terminal ${existing.length + 1}`),
    cwd: input.cwd ?? null,
    position: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(userTerminals).values(row).run();
  return row;
}

export function renameUserTerminal(id: string, name: string): UserTerminal | null {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const db = getDb();
  const existing = db.select().from(userTerminals).where(eq(userTerminals.id, id)).get();
  if (!existing) return null;
  const next = { ...existing, name: trimmed, updatedAt: Date.now() };
  db.update(userTerminals).set(next).where(eq(userTerminals.id, id)).run();
  return next;
}

export function deleteUserTerminal(id: string): boolean {
  const db = getDb();
  const result = db.delete(userTerminals).where(eq(userTerminals.id, id)).run();
  return result.changes > 0;
}
