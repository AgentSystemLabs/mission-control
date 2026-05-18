import type { UserTerminal } from "~/db/schema";
import type { HostedAuthContext } from "../hosted-auth-context";
import { normalizeHostedWorkspacePath } from "~/shared/hosted-workspace";
import { getHostedPool } from "../hosted-pg";
import { ValidationError } from "../errors";
import { getHostedProject } from "./hosted-projects";
import { newId } from "./_ids";
import { enforceHostedPlanLimit } from "./hosted-plan-limits";

type HostedUserTerminalRow = {
  id: string;
  projectId: string;
  name: string;
  cwd: string | null;
  startCommand: string | null;
  position: number;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
};

function scopeParams(context: HostedAuthContext): [string | null, string] {
  return [context.organizationId, context.userId];
}

function scopedProjectWhere(alias = '"hostedProject"') {
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

function mapTerminal(row: HostedUserTerminalRow): UserTerminal {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    cwd: normalizeHostedWorkspacePath(row.cwd),
    startCommand: row.startCommand,
    position: row.position,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  };
}

export async function listHostedUserTerminals(
  context: HostedAuthContext,
  projectId: string,
): Promise<UserTerminal[]> {
  const result = await getHostedPool().query<HostedUserTerminalRow>(
    `SELECT "hostedUserTerminal".* FROM "hostedUserTerminal"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedUserTerminal"."projectId"
      WHERE ${scopedProjectWhere()}
        AND "hostedUserTerminal"."projectId" = $3
        AND "hostedUserTerminal"."startCommand" IS NULL
      ORDER BY "hostedUserTerminal"."position" ASC, "hostedUserTerminal"."createdAt" ASC`,
    [...scopeParams(context), projectId],
  );
  return result.rows.map(mapTerminal);
}

export async function createHostedUserTerminal(
  context: HostedAuthContext,
  input: {
    projectId: string;
    name?: string;
    cwd?: string | null;
    startCommand?: string | null;
  },
): Promise<UserTerminal> {
  const project = await getHostedProject(context, input.projectId);
  if (!project) throw new ValidationError("Project does not exist");
  await enforceHostedPlanLimit(context, "userTerminals");
  const existing = await listHostedUserTerminals(context, input.projectId);
  const id = newId("hut");
  const name = input.name?.trim() || `Terminal ${existing.length + 1}`;
  const startCommand = input.startCommand?.trim() || null;
  if (startCommand) {
    const now = Date.now();
    return {
      id,
      projectId: input.projectId,
      name,
      cwd: normalizeHostedWorkspacePath(input.cwd),
      startCommand,
      position: existing.length,
      createdAt: now,
      updatedAt: now,
    };
  }
  const result = await getHostedPool().query<HostedUserTerminalRow>(
    `INSERT INTO "hostedUserTerminal" (
        "id", "projectId", "name", "cwd", "startCommand", "position"
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
    [id, input.projectId, name, normalizeHostedWorkspacePath(input.cwd), null, existing.length],
  );
  return mapTerminal(result.rows[0]!);
}

export async function renameHostedUserTerminal(
  context: HostedAuthContext,
  id: string,
  name: string,
): Promise<UserTerminal | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Name is required");
  const result = await getHostedPool().query<HostedUserTerminalRow>(
    `UPDATE "hostedUserTerminal"
      SET "name" = $4, "updatedAt" = now()
      WHERE "hostedUserTerminal"."id" = $3
        AND "hostedUserTerminal"."projectId" IN (
          SELECT "id" FROM "hostedProject" WHERE ${scopedProjectWhere()}
        )
      RETURNING *`,
    [...scopeParams(context), id, trimmed],
  );
  return result.rows[0] ? mapTerminal(result.rows[0]) : null;
}

export async function deleteHostedUserTerminal(
  context: HostedAuthContext,
  id: string,
): Promise<boolean> {
  const result = await getHostedPool().query(
    `DELETE FROM "hostedUserTerminal"
      WHERE "hostedUserTerminal"."id" = $3
        AND "hostedUserTerminal"."projectId" IN (
          SELECT "id" FROM "hostedProject" WHERE ${scopedProjectWhere()}
        )`,
    [...scopeParams(context), id],
  );
  return (result.rowCount ?? 0) > 0;
}
