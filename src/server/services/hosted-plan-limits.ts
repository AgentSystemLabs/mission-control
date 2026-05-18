import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool } from "../hosted-pg";
import { ValidationError } from "../errors";
import { logHostedEvent } from "./hosted-logs";

type ResourceLimitKind = "projects" | "tasks" | "userTerminals";
type LimitKind = ResourceLimitKind | "computeSeconds";

type PlanLimits = Partial<Record<LimitKind, number>>;

const DEFAULT_LIMITS: Required<PlanLimits> = {
  projects: 25,
  tasks: 250,
  userTerminals: 25,
  computeSeconds: 0,
};

type CountRow = { count: string | number };
type UsageRow = { total: string | number | null };
type TierRow = { sourceTier: string | null };
type BillingPeriodRow = { currentPeriodStartsAt: Date | string | null };

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

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function baseLimits(): Required<PlanLimits> {
  return {
    projects: envNumber("MC_MAX_PROJECTS_PER_USER", DEFAULT_LIMITS.projects),
    tasks: envNumber("MC_MAX_TASKS_PER_USER", DEFAULT_LIMITS.tasks),
    userTerminals: envNumber("MC_MAX_USER_TERMINALS_PER_USER", DEFAULT_LIMITS.userTerminals),
    computeSeconds: envNumber("MC_MAX_COMPUTE_SECONDS_PER_USER", DEFAULT_LIMITS.computeSeconds),
  };
}

function parseConfiguredPlanLimits(): Record<string, PlanLimits> {
  const raw = process.env.MC_PLAN_LIMITS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, PlanLimits> = {};
    for (const [tier, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const source = value as Record<string, unknown>;
      out[tier] = {};
      for (const kind of ["projects", "tasks", "userTerminals", "computeSeconds"] as const) {
        const numeric = Number(source[kind]);
        if (Number.isFinite(numeric) && numeric >= 0) out[tier]![kind] = numeric;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function sourceTier(context: HostedAuthContext): Promise<string> {
  const result = await getHostedPool().query<TierRow>(
    `SELECT "sourceTier"
      FROM "academyAccountLink"
      WHERE "userId" = $1
      LIMIT 1`,
    [context.userId],
  );
  return result.rows[0]?.sourceTier ?? "default";
}

function computeLimitWindowDays(): number {
  return envNumber("MC_COMPUTE_LIMIT_WINDOW_DAYS", 30);
}

async function currentBillingPeriodStart(context: HostedAuthContext): Promise<Date | null> {
  const result = await getHostedPool().query<BillingPeriodRow>(
    `SELECT "currentPeriodStartsAt"
      FROM "subscriptionEntitlement"
      WHERE (
        ($1::text IS NOT NULL AND "organizationId" = $1)
        OR (
          $1::text IS NULL
          AND "organizationId" IS NULL
          AND "userId" = $2
        )
      )
      ORDER BY "updatedAt" DESC
      LIMIT 1`,
    scopeParams(context),
  );
  const value = result.rows[0]?.currentPeriodStartsAt;
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

async function countResources(context: HostedAuthContext, kind: ResourceLimitKind): Promise<number> {
  const params = scopeParams(context);
  if (kind === "projects") {
    const result = await getHostedPool().query<CountRow>(
      `SELECT count(*)::int AS count
        FROM "hostedProject"
        WHERE ${scopedProjectWhere()}`,
      params,
    );
    return Number(result.rows[0]?.count ?? 0);
  }
  if (kind === "tasks") {
    const result = await getHostedPool().query<CountRow>(
      `SELECT count(*)::int AS count
        FROM "hostedTask"
        INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedTask"."projectId"
        WHERE ${scopedProjectWhere()}`,
      params,
    );
    return Number(result.rows[0]?.count ?? 0);
  }
  const result = await getHostedPool().query<CountRow>(
    `SELECT count(*)::int AS count
      FROM "hostedUserTerminal"
      INNER JOIN "hostedProject" ON "hostedProject"."id" = "hostedUserTerminal"."projectId"
      WHERE ${scopedProjectWhere()}
        AND "hostedUserTerminal"."startCommand" IS NULL`,
    params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countComputeSeconds(
  context: HostedAuthContext,
  windowDays: number,
  periodStart: Date | null,
): Promise<number> {
  const result = await getHostedPool().query<UsageRow>(
    `WITH usage_window AS (
        SELECT COALESCE($3::timestamp, now() - ($4::integer * interval '1 day')) AS "startsAt"
      )
      SELECT COALESCE(
        sum(
          GREATEST(
            0,
            EXTRACT(EPOCH FROM (
              COALESCE(u."endedAt", now()) - GREATEST(u."startedAt", usage_window."startsAt")
            ))::integer
          )
        ),
        0
      )::int AS total
      FROM "hostedRuntimeUsage" u
      CROSS JOIN usage_window
      WHERE COALESCE(u."endedAt", now()) >= usage_window."startsAt"
        AND (
          ($1::text IS NOT NULL AND u."organizationId" = $1)
          OR (
            $1::text IS NULL
            AND u."organizationId" IS NULL
            AND u."userId" = $2
          )
        )`,
    [...scopeParams(context), periodStart, windowDays],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function hostedComputeLimitStatus(context: HostedAuthContext): Promise<{
  allowed: boolean;
  tier: string;
  limitSeconds: number;
  usedSeconds: number;
  windowDays: number;
  currentPeriodStartsAt: string | null;
}> {
  const [tier, periodStart] = await Promise.all([
    sourceTier(context),
    currentBillingPeriodStart(context),
  ]);
  const configured = parseConfiguredPlanLimits();
  const limitSeconds =
    configured[tier]?.computeSeconds ??
    configured.default?.computeSeconds ??
    baseLimits().computeSeconds;
  const windowDays = computeLimitWindowDays();
  if (!limitSeconds) {
    return {
      allowed: true,
      tier,
      limitSeconds: 0,
      usedSeconds: 0,
      windowDays,
      currentPeriodStartsAt: periodStart?.toISOString() ?? null,
    };
  }
  const usedSeconds = await countComputeSeconds(context, windowDays, periodStart);
  return {
    allowed: usedSeconds < limitSeconds,
    tier,
    limitSeconds,
    usedSeconds,
    windowDays,
    currentPeriodStartsAt: periodStart?.toISOString() ?? null,
  };
}

export async function enforceHostedComputeLimit(context: HostedAuthContext): Promise<{
  limitSeconds: number;
  usedSeconds: number;
  windowDays: number;
}> {
  const status = await hostedComputeLimitStatus(context);
  if (status.allowed) return status;

  logHostedEvent("plan_limit.denied", {
    kind: "computeSeconds",
    tier: status.tier,
    limit: status.limitSeconds,
    current: status.usedSeconds,
    windowDays: status.windowDays,
    currentPeriodStartsAt: status.currentPeriodStartsAt,
    userId: context.userId,
    organizationId: context.organizationId,
  }, "warn");
  throw new ValidationError(
    status.currentPeriodStartsAt
      ? "compute limit reached for the current billing period"
      : `compute limit reached for the last ${status.windowDays} days`,
  );
}

export async function enforceHostedPlanLimit(
  context: HostedAuthContext,
  kind: LimitKind,
): Promise<void> {
  const tier = await sourceTier(context);
  const configured = parseConfiguredPlanLimits();
  const limit = configured[tier]?.[kind] ?? configured.default?.[kind] ?? baseLimits()[kind];
  if (kind === "computeSeconds") {
    await enforceHostedComputeLimit(context);
    return;
  }
  const current = await countResources(context, kind);
  if (current < limit) return;

  logHostedEvent("plan_limit.denied", {
    kind,
    tier,
    limit,
    current,
    userId: context.userId,
    organizationId: context.organizationId,
  }, "warn");
  throw new ValidationError(`${kind} plan limit reached`);
}
