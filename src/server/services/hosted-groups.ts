import type { Group } from "~/db/schema";
import { GROUP_COLORS } from "~/lib/design-meta";
import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool } from "../hosted-pg";
import { events, scopeForHostedContext } from "../events";
import { ValidationError } from "../errors";
import { newId } from "./_ids";

type HostedGroupRow = {
  id: string;
  name: string;
  color: string;
  createdAt: Date | string | number;
};

function scopeParams(context: HostedAuthContext): [string | null, string] {
  return [context.organizationId, context.userId];
}

function scopedGroupWhere(alias = '"hostedGroup"') {
  return `(
    ($1::text IS NOT NULL AND ${alias}."organizationId" = $1)
    OR (
      $1::text IS NULL
      AND ${alias}."organizationId" IS NULL
      AND ${alias}."ownerUserId" = $2
    )
  )`;
}

function toMillis(value: Date | string | number): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function mapGroup(row: HostedGroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: toMillis(row.createdAt),
  };
}

export async function listHostedGroups(context: HostedAuthContext): Promise<Group[]> {
  const result = await getHostedPool().query<HostedGroupRow>(
    `SELECT "id", "name", "color", "createdAt"
      FROM "hostedGroup"
      WHERE ${scopedGroupWhere()}
      ORDER BY "createdAt" ASC`,
    scopeParams(context),
  );
  return result.rows.map(mapGroup);
}

export async function hostedGroupExists(
  context: HostedAuthContext,
  id: string,
): Promise<boolean> {
  const result = await getHostedPool().query<{ id: string }>(
    `SELECT "id"
      FROM "hostedGroup"
      WHERE ${scopedGroupWhere()} AND "id" = $3
      LIMIT 1`,
    [...scopeParams(context), id],
  );
  return result.rows.length > 0;
}

export async function createHostedGroup(
  context: HostedAuthContext,
  input: { name: string; color?: string },
): Promise<Group> {
  if (!input.name?.trim()) throw new ValidationError("Group name is required");
  const existing = await listHostedGroups(context);
  const id = newId("hg");
  const color = input.color || GROUP_COLORS[existing.length % GROUP_COLORS.length] || "#ff5a1f";
  const result = await getHostedPool().query<HostedGroupRow>(
    `INSERT INTO "hostedGroup" ("id", "organizationId", "ownerUserId", "name", "color")
      VALUES ($1, $2, $3, $4, $5)
      RETURNING "id", "name", "color", "createdAt"`,
    [
      id,
      context.organizationId,
      context.organizationId ? null : context.userId,
      input.name.trim(),
      color,
    ],
  );
  events.emit("group:created", { id, scope: scopeForHostedContext(context) });
  return mapGroup(result.rows[0]!);
}

export async function updateHostedGroup(
  context: HostedAuthContext,
  id: string,
  patch: Partial<Pick<Group, "name" | "color">>,
): Promise<Group | null> {
  const result = await getHostedPool().query<HostedGroupRow>(
    `UPDATE "hostedGroup"
      SET "name" = COALESCE($4, "name"),
        "color" = COALESCE($5, "color")
      WHERE ${scopedGroupWhere()} AND "id" = $3
      RETURNING "id", "name", "color", "createdAt"`,
    [...scopeParams(context), id, patch.name ?? null, patch.color ?? null],
  );
  const row = result.rows[0];
  if (!row) return null;
  events.emit("group:updated", { id, scope: scopeForHostedContext(context) });
  return mapGroup(row);
}

export async function deleteHostedGroup(
  context: HostedAuthContext,
  id: string,
): Promise<boolean> {
  const result = await getHostedPool().query(
    `DELETE FROM "hostedGroup"
      WHERE ${scopedGroupWhere()} AND "id" = $3`,
    [...scopeParams(context), id],
  );
  if ((result.rowCount ?? 0) > 0) {
    events.emit("group:deleted", { id, scope: scopeForHostedContext(context) });
    return true;
  }
  return false;
}

