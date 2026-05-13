import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "~/db/client";
import { projects, userTerminals } from "~/db/schema";
import type { UserTerminal } from "~/db/schema";
import { events } from "../events";

function newId() {
  return `ut-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export class DuplicateUserTerminalNameError extends Error {
  constructor(public readonly projectId: string, public readonly name: string) {
    super(`A terminal named "${name}" already exists for this project.`);
    this.name = "DuplicateUserTerminalNameError";
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

/** Read-only listing. Use {@link purgeLaunchSpawnedTerminals} for the cleanup
 * side effect that used to live here. */
export function listUserTerminals(projectId: string): UserTerminal[] {
  const db = getDb();
  return db
    .select()
    .from(userTerminals)
    .where(and(eq(userTerminals.projectId, projectId), isNull(userTerminals.startCommand)))
    .orderBy(asc(userTerminals.position), asc(userTerminals.createdAt))
    .all();
}

/**
 * Drop launch-spawned user terminals (rows with a non-null start_command) so
 * the next render doesn't respawn the command and pretend the run survived a
 * restart. Pass a project id to scope, or omit to purge across all projects
 * (used at app boot).
 */
export function purgeLaunchSpawnedTerminals(projectId?: string): number {
  const db = getDb();
  const where = projectId
    ? and(eq(userTerminals.projectId, projectId), isNotNull(userTerminals.startCommand))
    : isNotNull(userTerminals.startCommand);
  const result = db.delete(userTerminals).where(where).run();
  return result.changes ?? 0;
}

export function createUserTerminal(input: {
  projectId: string;
  name?: string;
  cwd?: string | null;
  startCommand?: string | null;
}): UserTerminal {
  const db = getDb();
  const projectExists = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!projectExists) throw new Error("Project does not exist");

  const now = Date.now();
  const startCommand = input.startCommand?.trim() || null;
  const trimmedName = input.name?.trim();
  const id = newId();

  // For session-only launch-spawned terminals, no row is persisted — the PTY
  // owns its own lifecycle. Return a synthetic row so the caller can wire up
  // the terminal without polluting the DB.
  if (startCommand) {
    return {
      id,
      projectId: input.projectId,
      name: trimmedName || "Terminal",
      cwd: input.cwd ?? null,
      startCommand,
      position: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Atomic INSERT with position computed from a subquery — no read-then-write
  // race with concurrent createUserTerminal calls for the same project.
  const positionExpr = sql<number>`COALESCE((SELECT MAX(${userTerminals.position}) + 1 FROM ${userTerminals} WHERE ${userTerminals.projectId} = ${input.projectId}), 0)`;

  let name = trimmedName;
  if (!name) {
    // Default name is "Terminal N" where N is the next position+1; cheap
    // single-statement count to derive a friendly default.
    const countRow = db
      .select({ n: sql<number>`COUNT(*)` })
      .from(userTerminals)
      .where(eq(userTerminals.projectId, input.projectId))
      .get();
    name = `Terminal ${(countRow?.n ?? 0) + 1}`;
  }

  try {
    const inserted = db
      .insert(userTerminals)
      .values({
        id,
        projectId: input.projectId,
        name,
        cwd: input.cwd ?? null,
        startCommand: null,
        position: positionExpr as unknown as number,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return inserted;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new DuplicateUserTerminalNameError(input.projectId, name);
    }
    throw err;
  }
}

export function renameUserTerminal(id: string, name: string): UserTerminal | null {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const db = getDb();
  try {
    const updated = db
      .update(userTerminals)
      .set({ name: trimmed, updatedAt: Date.now() })
      .where(eq(userTerminals.id, id))
      .returning()
      .get();
    return updated ?? null;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Look up projectId only on the failure path.
      const existing = db.select().from(userTerminals).where(eq(userTerminals.id, id)).get();
      throw new DuplicateUserTerminalNameError(existing?.projectId ?? "", trimmed);
    }
    throw err;
  }
}

export function deleteUserTerminal(id: string): boolean {
  const db = getDb();
  const existing = db
    .select({ projectId: userTerminals.projectId })
    .from(userTerminals)
    .where(eq(userTerminals.id, id))
    .get();
  const result = db.delete(userTerminals).where(eq(userTerminals.id, id)).run();
  if (result.changes > 0) {
    // Emit so the live PTY shuts down — mirrors deleteProject's per-terminal emit.
    events.emit("user-terminal:deleted", {
      id,
      projectId: existing?.projectId ?? "",
    });
    return true;
  }
  return false;
}
