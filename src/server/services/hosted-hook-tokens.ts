import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool } from "../hosted-pg";
import { logHostedEvent } from "./hosted-logs";
import { incrementHostedCounter } from "./hosted-metrics";

const HOOK_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

type HookTokenRow = {
  taskId: string;
  tokenHash: string;
  revokedAt: Date | string | null;
  expiresAt: Date | string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

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

export async function issueHostedHookToken(
  context: HostedAuthContext,
  taskId: string,
): Promise<string | null> {
  const token = randomBytes(32).toString("hex");
  const id = `hkt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const expiresAt = new Date(Date.now() + HOOK_TOKEN_TTL_MS);
  const result = await getHostedPool().query(
    `INSERT INTO "hookToken" ("id", "taskId", "tokenHash", "expiresAt")
      SELECT $4, "hostedTask"."id", $5, $6
      FROM "hostedTask"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedTask"."projectId"
      WHERE ${scopedProjectWhere()} AND "hostedTask"."id" = $3`,
    [...scopeParams(context), taskId, id, hashToken(token), expiresAt],
  );
  const issued = (result.rowCount ?? 0) > 0;
  logHostedEvent(issued ? "hook_token.issued" : "hook_token.issue_denied", {
    taskId,
    userId: context.userId,
    organizationId: context.organizationId,
  }, issued ? "info" : "warn");
  return issued ? token : null;
}

export async function validateHostedHookToken(
  taskId: string,
  rawToken: string | null | undefined,
): Promise<boolean> {
  const token = (rawToken ?? "").trim();
  if (!taskId || !token) {
    incrementHostedCounter("hookFailures");
    logHostedEvent("hook_token.validation_failed", {
      taskId: taskId || null,
      reason: !taskId ? "missing_task_id" : "missing_token",
    }, "warn");
    return false;
  }
  const result = await getHostedPool().query<HookTokenRow>(
    `SELECT "taskId", "tokenHash", "revokedAt", "expiresAt"
      FROM "hookToken"
      WHERE "taskId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()
      ORDER BY "createdAt" DESC
      LIMIT 10`,
    [taskId],
  );
  const incoming = Buffer.from(hashToken(token), "hex");
  const ok = result.rows.some((row) => {
    const expected = Buffer.from(row.tokenHash, "hex");
    return expected.length === incoming.length && timingSafeEqual(expected, incoming);
  });
  if (!ok) {
    incrementHostedCounter("hookFailures");
    logHostedEvent("hook_token.validation_failed", { taskId, reason: "no_match" }, "warn");
  }
  return ok;
}

export async function revokeHostedHookTokens(taskId: string): Promise<void> {
  if (!taskId) return;
  await getHostedPool().query(
    `UPDATE "hookToken"
      SET "revokedAt" = now()
      WHERE "taskId" = $1 AND "revokedAt" IS NULL`,
    [taskId],
  );
  logHostedEvent("hook_token.revoked", { taskId });
}
