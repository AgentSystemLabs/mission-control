import type { Group } from "~/db/schema";
import { events } from "../events";
import { getRepositories } from "../repositories";
import { isUniqueConstraintError as isSqliteUniqueConstraintError } from "../repositories/sqlite";
import { isUniqueConstraintError as isPostgresUniqueConstraintError } from "../repositories/postgres";

export class DuplicateGroupNameError extends Error {
  constructor(public readonly name: string) {
    super(`A group named "${name}" already exists.`);
    this.name = "DuplicateGroupNameError";
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return isSqliteUniqueConstraintError(err) || isPostgresUniqueConstraintError(err);
}

export async function listGroups(ownerUserId?: string | null): Promise<Group[]> {
  return getRepositories().groups.list({ userId: ownerUserId });
}

export async function createGroup(input: { name: string; color?: string; ownerUserId?: string | null }): Promise<Group> {
  if (!input.name?.trim()) throw new Error("Group name is required");
  try {
    const row = await getRepositories().groups.create(input);
    events.emit("group:created", { id: row.id });
    return row;
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new DuplicateGroupNameError(input.name.trim());
    throw err;
  }
}

export async function updateGroup(
  id: string,
  patch: Partial<Pick<Group, "name" | "color">>,
  ownerUserId?: string | null,
): Promise<Group | null> {
  try {
    const next = await getRepositories().groups.update(id, patch, { userId: ownerUserId });
    if (next) events.emit("group:updated", { id });
    return next;
  } catch (err) {
    if (isUniqueConstraintError(err) && patch.name !== undefined) {
      throw new DuplicateGroupNameError(String(patch.name));
    }
    throw err;
  }
}

export async function deleteGroup(id: string, ownerUserId?: string | null): Promise<boolean> {
  const result = await getRepositories().groups.delete(id, { userId: ownerUserId });
  events.emit("group:deleted", { id });
  return result;
}
