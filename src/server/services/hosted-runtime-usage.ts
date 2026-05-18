import { randomUUID } from "node:crypto";
import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool, isHostedDatabaseEnabled } from "../hosted-pg";
import { logHostedEvent } from "./hosted-logs";

type HostedRuntimeUsageRow = {
  userId: string;
  organizationId: string | null;
  totalSessions: string | number;
  activeSessions: string | number;
  totalDurationSeconds: string | number | null;
  lastStartedAt: Date | string | null;
};

function numberFromDb(value: string | number | null): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function recordHostedRuntimeStart(input: {
  context: HostedAuthContext;
  projectId: string;
  taskId?: string | null;
  ptyId: string;
  sandboxId?: string | null;
}): Promise<void> {
  if (!isHostedDatabaseEnabled()) return;
  await getHostedPool().query(
    `INSERT INTO "hostedRuntimeUsage" (
        "id", "organizationId", "userId", "projectId", "taskId", "ptyId", "sandboxId"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT ("ptyId") DO NOTHING`,
    [
      `hru_${randomUUID()}`,
      input.context.organizationId,
      input.context.userId,
      input.projectId,
      input.taskId ?? null,
      input.ptyId,
      input.sandboxId ?? null,
    ],
  );
  logHostedEvent("runtime_usage.started", {
    ptyId: input.ptyId,
    userId: input.context.userId,
    organizationId: input.context.organizationId,
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    sandboxId: input.sandboxId ?? null,
  });
}

export async function recordHostedRuntimeEnd(ptyId: string): Promise<void> {
  if (!isHostedDatabaseEnabled()) return;
  await getHostedPool().query(
    `UPDATE "hostedRuntimeUsage"
      SET "endedAt" = COALESCE("endedAt", now()),
        "durationSeconds" = GREATEST(
          0,
          EXTRACT(EPOCH FROM (COALESCE("endedAt", now()) - "startedAt"))::integer
        ),
        "updatedAt" = now()
      WHERE "ptyId" = $1`,
    [ptyId],
  );
  logHostedEvent("runtime_usage.ended", { ptyId });
}

export async function summarizeHostedRuntimeUsage(days = 30): Promise<Array<{
  userId: string;
  organizationId: string | null;
  totalSessions: number;
  activeSessions: number;
  totalDurationSeconds: number;
  lastStartedAt: string | null;
}>> {
  if (!isHostedDatabaseEnabled()) return [];
  const result = await getHostedPool().query<HostedRuntimeUsageRow>(
    `SELECT "userId", "organizationId",
        count(*) AS "totalSessions",
        count(*) FILTER (WHERE "endedAt" IS NULL) AS "activeSessions",
        sum(COALESCE("durationSeconds", EXTRACT(EPOCH FROM (now() - "startedAt"))::integer)) AS "totalDurationSeconds",
        max("startedAt") AS "lastStartedAt"
      FROM "hostedRuntimeUsage"
      WHERE "startedAt" >= now() - ($1::integer * interval '1 day')
      GROUP BY "userId", "organizationId"
      ORDER BY "totalDurationSeconds" DESC
      LIMIT 200`,
    [days],
  );
  return result.rows.map((row) => ({
    userId: row.userId,
    organizationId: row.organizationId,
    totalSessions: numberFromDb(row.totalSessions),
    activeSessions: numberFromDb(row.activeSessions),
    totalDurationSeconds: numberFromDb(row.totalDurationSeconds),
    lastStartedAt: iso(row.lastStartedAt),
  }));
}
