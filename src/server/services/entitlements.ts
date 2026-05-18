import type { Entitlements } from "~/shared/entitlements";
import type { HostedAuthContext } from "../hosted-auth-context";
import { getHostedPool, isHostedDatabaseEnabled } from "../hosted-pg";
import { logHostedEvent } from "./hosted-logs";

type SubscriptionEntitlementRow = {
  plan: "none" | "trial" | "paid";
  status: "inactive" | "trialing" | "active" | "past_due" | "canceled";
  remoteRuntimeEnabled: boolean;
  trialEndsAt: Date | string | null;
  currentPeriodEndsAt: Date | string | null;
};

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dateIsCurrent(value: Date | string | null): boolean {
  if (!value) return true;
  return (value instanceof Date ? value : new Date(value)).getTime() > Date.now();
}

function scopeParams(context: HostedAuthContext): [string | null, string] {
  return [context.organizationId, context.userId];
}

function envList(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function blockedHostedAccountReason(context: HostedAuthContext): string | null {
  if (envList("MC_BLOCKED_HOSTED_USER_IDS").has(context.userId)) return "blocked_user";
  if (envList("MC_BLOCKED_ACADEMY_USER_IDS").has(context.academyUserId)) return "blocked_academy_user";
  if (context.organizationId && envList("MC_BLOCKED_ORGANIZATION_IDS").has(context.organizationId)) {
    return "blocked_organization";
  }
  return null;
}

async function readRemoteRuntimeEntitlement(context: HostedAuthContext) {
  const blockedReason = blockedHostedAccountReason(context);
  if (blockedReason) {
    logHostedEvent("entitlement.remote_runtime_denied", {
      userId: context.userId,
      academyUserId: context.academyUserId,
      organizationId: context.organizationId,
      reason: blockedReason,
    }, "warn");
    return {
      allowed: false,
      reason: "account-blocked" as const,
      plan: "none" as const,
      trialEndsAt: null,
    };
  }

  const result = await getHostedPool().query<SubscriptionEntitlementRow>(
    `SELECT "plan", "status", "remoteRuntimeEnabled", "trialEndsAt", "currentPeriodEndsAt"
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
  const row = result.rows[0];
  if (!row || !row.remoteRuntimeEnabled) {
    logHostedEvent("entitlement.remote_runtime_denied", {
      userId: context.userId,
      organizationId: context.organizationId,
      reason: row ? "remote_runtime_disabled" : "missing_entitlement",
    }, "warn");
    return null;
  }

  if (row.plan === "trial" && row.status === "trialing" && dateIsCurrent(row.trialEndsAt)) {
    logHostedEvent("entitlement.remote_runtime_allowed", {
      userId: context.userId,
      organizationId: context.organizationId,
      plan: row.plan,
      status: row.status,
    });
    return {
      allowed: true,
      reason: null,
      plan: "trial" as const,
      trialEndsAt: toIso(row.trialEndsAt),
    };
  }

  if (row.plan === "paid" && row.status === "active" && dateIsCurrent(row.currentPeriodEndsAt)) {
    logHostedEvent("entitlement.remote_runtime_allowed", {
      userId: context.userId,
      organizationId: context.organizationId,
      plan: row.plan,
      status: row.status,
    });
    return {
      allowed: true,
      reason: null,
      plan: "paid" as const,
      trialEndsAt: null,
    };
  }

  logHostedEvent("entitlement.remote_runtime_denied", {
    userId: context.userId,
    organizationId: context.organizationId,
    plan: row.plan,
    status: row.status,
    reason: "inactive_or_expired",
  }, "warn");
  return null;
}

export async function readEntitlements(
  context: HostedAuthContext | null,
  opts: { hostedEnabled?: boolean } = {},
): Promise<Entitlements> {
  const hostedEnabled = opts.hostedEnabled ?? isHostedDatabaseEnabled();
  const remoteRuntime =
    context && hostedEnabled
      ? await readRemoteRuntimeEntitlement(context)
      : null;

  return {
    hosted: {
      enabled: hostedEnabled,
      userId: context?.userId ?? null,
      organizationId: context?.organizationId ?? null,
    },
    remoteRuntime: remoteRuntime
      ? remoteRuntime
      : context
      ? {
          allowed: false,
          reason: "subscription-required",
          plan: "none",
          trialEndsAt: null,
        }
      : {
          allowed: false,
          reason: "auth-required",
          plan: "none",
          trialEndsAt: null,
        },
  };
}
