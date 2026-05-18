import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";
import { json, jsonError, parseJsonBody } from "./_helpers";
import { getHostedPool, isHostedDatabaseEnabled } from "../hosted-pg";
import { listActiveRemotePtySummaries } from "../services/daytona-remote-pty";
import { logHostedEvent } from "../services/hosted-logs";
import {
  academyEntitlementClaims,
  syncAcademyEntitlementClaims,
  validateAcademyClaimsFreshness,
} from "../services/academy-auth";
import { summarizeHostedRuntimeUsage } from "../services/hosted-runtime-usage";

type AccountLinkRow = {
  userId: string;
  academyUserId: string;
  email: string;
  emailVerified: boolean;
  sourceTier: string | null;
  billingStatus: string;
  missionControlHosted: boolean;
  remoteRuntimeEnabled: boolean;
  lastSyncedAt: Date | string | null;
  lastAcademyEntitlementVersion: string | null;
};

type SessionRow = {
  id: string;
  userId: string;
  academyUserId: string;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type EntitlementRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  plan: string;
  status: string;
  remoteRuntimeEnabled: boolean;
  trialEndsAt: Date | string | null;
  currentPeriodStartsAt: Date | string | null;
  currentPeriodEndsAt: Date | string | null;
  updatedAt: Date | string;
};

type CleanupRow = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  payload: unknown;
};

type ProjectRow = {
  id: string;
  name: string;
  runtime: string;
  remoteProvider: string | null;
  remoteSandboxId: string | null;
  remotePath: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RuntimeUsageRow = {
  id: string;
  projectId: string;
  taskId: string | null;
  ptyId: string;
  provider: string;
  sandboxId: string | null;
  startedAt: Date | string;
  endedAt: Date | string | null;
  durationSeconds: number | null;
};

const entitlementAdjustmentBody = z.object({
  userId: z.string().min(1).optional(),
  academyUserId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  plan: z.enum(["none", "trial", "paid"]),
  status: z.enum(["inactive", "trialing", "active", "past_due", "canceled"]),
  remoteRuntimeEnabled: z.boolean(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  currentPeriodStartsAt: z.string().datetime().nullable().optional(),
  currentPeriodEndsAt: z.string().datetime().nullable().optional(),
  reason: z.string().min(1),
}).refine((body) => !!body.userId || !!body.academyUserId || !!body.email, {
  message: "userId, academyUserId, or email is required",
});

const cleanupRetryBody = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});

const entitlementReplayBody = z.object({
  claims: academyEntitlementClaims,
  reason: z.string().min(1),
});

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function parseCurrentPeriodStart(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (date.getTime() > Date.now() + 60_000) {
    throw new Error("currentPeriodStartsAt cannot be in the future");
  }
  return date;
}

function requestedLookup(url: URL): { userId?: string; academyUserId?: string; email?: string } | null {
  const userId = url.searchParams.get("userId")?.trim();
  const academyUserId = url.searchParams.get("academyUserId")?.trim();
  const email = url.searchParams.get("email")?.trim();
  if (userId) return { userId };
  if (academyUserId) return { academyUserId };
  if (email) return { email };
  return null;
}

function normalizeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      next[key] = value instanceof Date ? value.toISOString() : value;
    }
    return next as T;
  });
}

async function auditAction(input: {
  actor?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getHostedPool().query(
    `INSERT INTO "hostedAdminAuditLog" (
        "id", "actor", "action", "targetType", "targetId", "reason", "metadata"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      `haal_${randomUUID()}`,
      input.actor || "support-api",
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.reason ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  logHostedEvent("support.audit", {
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
  });
}

export async function diagnostics(url: URL): Promise<Response> {
  if (!isHostedDatabaseEnabled()) return json({ hostedEnabled: false });
  const lookup = requestedLookup(url);
  if (!lookup) {
    return jsonError(HTTP_BAD_REQUEST, "userId, academyUserId, or email is required");
  }

  const pool = getHostedPool();
  const accountResult = await pool.query<AccountLinkRow>(
    `SELECT "userId", "academyUserId", "email", "emailVerified", "sourceTier",
        "billingStatus", "missionControlHosted", "remoteRuntimeEnabled",
        "lastSyncedAt", "lastAcademyEntitlementVersion"
      FROM "academyAccountLink"
      WHERE ($1::text IS NULL OR "userId" = $1)
        AND ($2::text IS NULL OR "academyUserId" = $2)
        AND ($3::text IS NULL OR lower("email") = lower($3))
      LIMIT 1`,
    [lookup.userId ?? null, lookup.academyUserId ?? null, lookup.email ?? null],
  );
  const account = accountResult.rows[0] ?? null;
  if (!account) {
    return json({
      hostedEnabled: true,
      account: null,
      sessions: [],
      entitlements: [],
      cleanupOutbox: [],
      runtimeUsage: [],
    });
  }

  const [sessions, entitlements, cleanupOutbox, projects, runtimeUsage] = await Promise.all([
    pool.query<SessionRow>(
      `SELECT "id", "userId", "academyUserId", "expiresAt", "revokedAt", "createdAt", "updatedAt"
        FROM "hostedSession"
        WHERE "academyUserId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 20`,
      [account.academyUserId],
    ),
    pool.query<EntitlementRow>(
      `SELECT "id", "organizationId", "userId", "plan", "status", "remoteRuntimeEnabled",
          "trialEndsAt", "currentPeriodStartsAt", "currentPeriodEndsAt", "updatedAt"
        FROM "subscriptionEntitlement"
        WHERE "userId" = $1
        ORDER BY "updatedAt" DESC
        LIMIT 20`,
      [account.userId],
    ),
    pool.query<CleanupRow>(
      `SELECT "id", "kind", "status", "attempts", "lastError", "createdAt", "updatedAt", "payload"
        FROM "hostedCleanupOutbox"
        WHERE "scope"->>'userId' = $1
        ORDER BY "updatedAt" DESC
        LIMIT 20`,
      [account.userId],
    ),
    pool.query<ProjectRow>(
      `SELECT "id", "name", "runtime", "remoteProvider", "remoteSandboxId",
          "remotePath", "createdAt", "updatedAt"
        FROM "hostedProject"
        WHERE "ownerUserId" = $1
        ORDER BY "updatedAt" DESC
        LIMIT 20`,
      [account.userId],
    ),
    pool.query<RuntimeUsageRow>(
      `SELECT "id", "projectId", "taskId", "ptyId", "provider", "sandboxId",
          "startedAt", "endedAt", "durationSeconds"
        FROM "hostedRuntimeUsage"
        WHERE "userId" = $1
        ORDER BY "startedAt" DESC
        LIMIT 50`,
      [account.userId],
    ),
  ]);

  return json({
    hostedEnabled: true,
    account: {
      ...account,
      lastSyncedAt: iso(account.lastSyncedAt),
    },
    sessions: normalizeRows(sessions.rows),
    entitlements: normalizeRows(entitlements.rows),
    cleanupOutbox: normalizeRows(cleanupOutbox.rows),
    projects: normalizeRows(projects.rows),
    runtimeUsage: normalizeRows(runtimeUsage.rows),
  });
}

export async function cleanupOutbox(): Promise<Response> {
  if (!isHostedDatabaseEnabled()) return json({ hostedEnabled: false, cleanupOutbox: [] });
  const result = await getHostedPool().query<CleanupRow>(
    `SELECT "id", "kind", "status", "attempts", "lastError", "createdAt", "updatedAt", "payload"
      FROM "hostedCleanupOutbox"
      WHERE "status" IN ('pending', 'processing', 'failed')
      ORDER BY "updatedAt" ASC
      LIMIT 100`,
  );
  return json({ hostedEnabled: true, cleanupOutbox: normalizeRows(result.rows) });
}

export async function retryCleanupOutbox(request: Request): Promise<Response> {
  if (!isHostedDatabaseEnabled()) return json({ hostedEnabled: false, retried: false });
  const parsed = await parseJsonBody(request, cleanupRetryBody);
  if (!parsed.ok) return parsed.response;
  const result = await getHostedPool().query<CleanupRow>(
    `UPDATE "hostedCleanupOutbox"
      SET "status" = 'failed',
        "lastError" = NULL,
        "updatedAt" = now() - interval '16 minutes'
      WHERE "id" = $1
      RETURNING "id", "kind", "status", "attempts", "lastError", "createdAt", "updatedAt", "payload"`,
    [parsed.data.id],
  );
  const row = result.rows[0] ?? null;
  if (row) {
    await auditAction({
      action: "cleanup.retry",
      targetType: "hostedCleanupOutbox",
      targetId: row.id,
      reason: parsed.data.reason,
      metadata: { status: row.status, attempts: row.attempts },
    });
  }
  return json({ hostedEnabled: true, retried: !!row, cleanupOutbox: row ? normalizeRows([row])[0] : null });
}

export async function adjustEntitlement(request: Request): Promise<Response> {
  if (!isHostedDatabaseEnabled()) return json({ hostedEnabled: false, adjusted: false });
  const parsed = await parseJsonBody(request, entitlementAdjustmentBody);
  if (!parsed.ok) return parsed.response;
  const pool = getHostedPool();
  const lookup = requestedLookup(
    new URL(`http://support.local/?${new URLSearchParams({
      ...(parsed.data.userId ? { userId: parsed.data.userId } : {}),
      ...(parsed.data.academyUserId ? { academyUserId: parsed.data.academyUserId } : {}),
      ...(parsed.data.email ? { email: parsed.data.email } : {}),
    })}`),
  );
  if (!lookup) return jsonError(HTTP_BAD_REQUEST, "userId, academyUserId, or email is required");
  const account = (await pool.query<AccountLinkRow>(
    `SELECT "userId", "academyUserId", "email", "emailVerified", "sourceTier",
        "billingStatus", "missionControlHosted", "remoteRuntimeEnabled",
        "lastSyncedAt", "lastAcademyEntitlementVersion"
      FROM "academyAccountLink"
      WHERE ($1::text IS NULL OR "userId" = $1)
        AND ($2::text IS NULL OR "academyUserId" = $2)
        AND ($3::text IS NULL OR lower("email") = lower($3))
      LIMIT 1`,
    [lookup.userId ?? null, lookup.academyUserId ?? null, lookup.email ?? null],
  )).rows[0];
  if (!account) return jsonError(HTTP_BAD_REQUEST, "account not found");

  const entitlementId = `ent_support_${randomUUID()}`;
  let currentPeriodStartsAt: Date | null;
  try {
    currentPeriodStartsAt = parseCurrentPeriodStart(parsed.data.currentPeriodStartsAt);
  } catch (error) {
    return jsonError(
      HTTP_BAD_REQUEST,
      error instanceof Error ? error.message : "invalid currentPeriodStartsAt",
    );
  }
  const result = await pool.query<EntitlementRow>(
    `INSERT INTO "subscriptionEntitlement" (
        "id", "organizationId", "userId", "plan", "status", "remoteRuntimeEnabled",
        "trialEndsAt", "currentPeriodStartsAt", "currentPeriodEndsAt", "createdAt", "updatedAt"
      )
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, now(), now())
      ON CONFLICT ("userId") WHERE "organizationId" IS NULL AND "userId" IS NOT NULL
      DO UPDATE SET
        "plan" = EXCLUDED."plan",
        "status" = EXCLUDED."status",
        "remoteRuntimeEnabled" = EXCLUDED."remoteRuntimeEnabled",
        "trialEndsAt" = EXCLUDED."trialEndsAt",
        "currentPeriodStartsAt" = EXCLUDED."currentPeriodStartsAt",
        "currentPeriodEndsAt" = EXCLUDED."currentPeriodEndsAt",
        "updatedAt" = now()
      RETURNING "id", "organizationId", "userId", "plan", "status", "remoteRuntimeEnabled",
        "trialEndsAt", "currentPeriodStartsAt", "currentPeriodEndsAt", "updatedAt"`,
    [
      entitlementId,
      account.userId,
      parsed.data.plan,
      parsed.data.status,
      parsed.data.remoteRuntimeEnabled,
      parsed.data.trialEndsAt ? new Date(parsed.data.trialEndsAt) : null,
      currentPeriodStartsAt,
      parsed.data.currentPeriodEndsAt ? new Date(parsed.data.currentPeriodEndsAt) : null,
    ],
  );
  await auditAction({
    action: "entitlement.adjust",
    targetType: "subscriptionEntitlement",
    targetId: result.rows[0]?.id ?? null,
    reason: parsed.data.reason,
    metadata: {
      userId: account.userId,
      academyUserId: account.academyUserId,
      plan: parsed.data.plan,
      status: parsed.data.status,
      remoteRuntimeEnabled: parsed.data.remoteRuntimeEnabled,
    },
  });
  return json({ hostedEnabled: true, adjusted: true, entitlement: normalizeRows(result.rows)[0] });
}

export async function replayEntitlement(request: Request): Promise<Response> {
  if (!isHostedDatabaseEnabled()) return json({ hostedEnabled: false, replayed: false });
  const parsed = await parseJsonBody(request, entitlementReplayBody);
  if (!parsed.ok) return parsed.response;
  validateAcademyClaimsFreshness(parsed.data.claims);

  const userId = await syncAcademyEntitlementClaims(parsed.data.claims);
  await auditAction({
    action: "entitlement.replay",
    targetType: "academyAccountLink",
    targetId: parsed.data.claims.academyUserId,
    reason: parsed.data.reason,
    metadata: {
      userId,
      academyUserId: parsed.data.claims.academyUserId,
      entitlementVersion: parsed.data.claims.entitlementVersion,
      missionControlHosted: parsed.data.claims.missionControlHosted,
      remoteRuntimeEnabled: parsed.data.claims.remoteRuntimeEnabled,
      billingStatus: parsed.data.claims.billingStatus,
      sourceTier: parsed.data.claims.sourceTier ?? null,
    },
  });

  return json({
    hostedEnabled: true,
    replayed: true,
    userId,
    academyUserId: parsed.data.claims.academyUserId,
    entitlementVersion: parsed.data.claims.entitlementVersion,
  });
}

export async function activeRemoteSessions(): Promise<Response> {
  return json({
    hostedEnabled: isHostedDatabaseEnabled(),
    remoteSessions: listActiveRemotePtySummaries(),
  });
}

export async function runtimeUsage(url: URL): Promise<Response> {
  const days = Number(url.searchParams.get("days") ?? 30);
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 366) : 30;
  return json({
    hostedEnabled: isHostedDatabaseEnabled(),
    days: windowDays,
    usage: await summarizeHostedRuntimeUsage(windowDays),
  });
}
