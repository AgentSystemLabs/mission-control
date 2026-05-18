import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getHostedPool, isHostedDatabaseEnabled } from "../hosted-pg";
import { getOrCreateAuthSecret } from "./settings";
import { HOSTED_SESSION_COOKIE } from "../hosted-auth-context";
import { logHostedEvent } from "./hosted-logs";
import { incrementHostedCounter } from "./hosted-metrics";

const STATE_COOKIE = "mc_academy_state";
const DEFAULT_SESSION_TTL_MINUTES = 60 * 24 * 7;
const DEFAULT_SESSION_RENEWAL_WINDOW_MINUTES = 60 * 24;

export const academyEntitlementClaims = z.object({
  audience: z.literal("mission-control"),
  academyUserId: z.union([z.string(), z.number()]).transform((value) => String(value)),
  email: z.string().email(),
  emailVerified: z.boolean().default(false),
  missionControlHosted: z.boolean(),
  remoteRuntimeEnabled: z.boolean(),
  sourceTier: z.string().nullable().optional(),
  billingStatus: z.enum(["active", "trialing", "past_due", "canceled", "inactive", "none"]),
  currentPeriodStartsAt: z.string().datetime().nullable().optional(),
  currentPeriodEndsAt: z.string().datetime().nullable().optional(),
  accessEndsAt: z.string().datetime().nullable().optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  entitlementVersion: z.string().min(1),
});

export type AcademyEntitlementClaims = z.infer<typeof academyEntitlementClaims>;

export type HostedSessionSummary = {
  hostedEnabled: boolean;
  authenticated: boolean;
  user: null | {
    id: string;
    academyUserId: string;
    email: string;
  };
  academyLoginUrl: string;
  academyAccountUrl: string;
};

function appOrigin(request: Request): string {
  const configured = process.env.MISSION_CONTROL_PUBLIC_URL?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function academyOrigin(): string {
  return (
    process.env.ACADEMY_PUBLIC_URL?.trim() ||
    process.env.VITE_ACADEMY_BASE_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

function academyAuthorizePath(): string {
  return process.env.ACADEMY_MISSION_CONTROL_AUTHORIZE_PATH?.trim() || "/api/mission-control/authorize";
}

function academyAccountPath(): string {
  return process.env.ACADEMY_ACCOUNT_PATH?.trim() || "/dashboard";
}

function academyLogoutPath(): string {
  return process.env.ACADEMY_LOGOUT_PATH?.trim() || "/api/logout";
}

export function academyLoginUrl(request: Request): string {
  const redirectUri = new URL("/api/academy-auth/callback", appOrigin(request)).toString();
  const url = new URL(academyAuthorizePath(), academyOrigin());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", createAcademyState());
  return url.toString();
}

export function academyAccountUrl(): string {
  return new URL(academyAccountPath(), academyOrigin()).toString();
}

export function academyLogoutUrl(): string {
  return new URL(academyLogoutPath(), academyOrigin()).toString();
}

function sessionSecret(): string {
  return (
    process.env.MC_SESSION_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    getOrCreateAuthSecret()
  );
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function createAcademyState(): string {
  const nonce = randomBytes(16).toString("hex");
  return `${nonce}.${sign(nonce)}`;
}

export function createAcademyStateCookieFromLoginUrl(loginUrl: string, request: Request): string {
  const state = new URL(loginUrl).searchParams.get("state") ?? "";
  return serializeCookie(STATE_COOKIE, state, {
    request,
    maxAgeSeconds: 10 * 60,
  });
}

export function verifyAcademyState(request: Request, state: string | null): boolean {
  const cookieState = cookieValue(request, STATE_COOKIE);
  if (!state || !cookieState || !tokensEqual(state, cookieState)) return false;
  const [nonce, signature] = state.split(".");
  if (!nonce || !signature) return false;
  return tokensEqual(sign(nonce), signature);
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionTtlMinutes(): number {
  const configured = Number(process.env.MC_SESSION_TTL_MINUTES ?? DEFAULT_SESSION_TTL_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_TTL_MINUTES;
}

function sessionRenewalWindowMinutes(): number {
  const configured = Number(
    process.env.MC_SESSION_RENEWAL_WINDOW_MINUTES ?? DEFAULT_SESSION_RENEWAL_WINDOW_MINUTES,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SESSION_RENEWAL_WINDOW_MINUTES;
}

function cookieSecure(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return new URL(request.url).protocol === "https:";
}

function serializeCookie(
  name: string,
  value: string,
  opts: { request: Request; maxAgeSeconds: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  const domain = process.env.MC_SESSION_COOKIE_DOMAIN?.trim();
  if (domain) parts.push(`Domain=${domain}`);
  if (cookieSecure(opts.request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearHostedSessionCookie(request: Request): string {
  return serializeCookie(HOSTED_SESSION_COOKIE, "", { request, maxAgeSeconds: 0 });
}

export function clearAcademyStateCookie(request: Request): string {
  return serializeCookie(STATE_COOKIE, "", { request, maxAgeSeconds: 0 });
}

async function fetchAcademyClaims(
  request: Request,
  input: { code?: string; token?: string },
): Promise<AcademyEntitlementClaims> {
  const endpoint = process.env.ACADEMY_ENTITLEMENTS_API_URL?.trim();
  const secret = process.env.ACADEMY_ENTITLEMENTS_API_SECRET?.trim();
  if (!endpoint) throw new Error("ACADEMY_ENTITLEMENTS_API_URL is required");
  if (!secret) throw new Error("ACADEMY_ENTITLEMENTS_API_SECRET is required");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      app: "mission-control",
      redirectUri: new URL("/api/academy-auth/callback", appOrigin(request)).toString(),
      ...input,
    }),
  });
  if (!res.ok) {
    incrementHostedCounter("academyEntitlementSyncFailures");
    logHostedEvent("academy.entitlement_exchange_failed", { status: res.status }, "warn");
    throw new Error(`Academy entitlement exchange failed: ${res.status}`);
  }
  const claims = academyEntitlementClaims.parse(await res.json());
  validateAcademyClaimsFreshness(claims);
  return claims;
}

export function validateAcademyClaimsFreshness(claims: AcademyEntitlementClaims): void {
  const now = Date.now();
  if (new Date(claims.expiresAt).getTime() <= now) {
    incrementHostedCounter("academyEntitlementSyncFailures");
    logHostedEvent("academy.entitlement_claims_expired", {
      academyUserId: claims.academyUserId,
      entitlementVersion: claims.entitlementVersion,
    }, "warn");
    throw new Error("Academy entitlement claims expired");
  }
  if (new Date(claims.issuedAt).getTime() > now + 60_000) {
    incrementHostedCounter("academyEntitlementSyncFailures");
    logHostedEvent("academy.entitlement_claims_future_issued", {
      academyUserId: claims.academyUserId,
      entitlementVersion: claims.entitlementVersion,
    }, "warn");
    throw new Error("Academy entitlement claims issued in the future");
  }
}

function missionControlUserId(academyUserId: string): string {
  return `academy:${academyUserId}`;
}

function entitlementPlan(claims: AcademyEntitlementClaims): "none" | "trial" | "paid" {
  if (!claims.remoteRuntimeEnabled) return "none";
  return claims.billingStatus === "trialing" ? "trial" : "paid";
}

function entitlementStatus(
  claims: AcademyEntitlementClaims,
): "inactive" | "trialing" | "active" | "past_due" | "canceled" {
  if (claims.billingStatus === "none") return "inactive";
  return claims.billingStatus;
}

function parseCurrentPeriodStart(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (date.getTime() > Date.now() + 60_000) {
    throw new Error("Academy current period start is in the future");
  }
  return date;
}

export async function syncAcademyEntitlementClaims(
  claims: AcademyEntitlementClaims,
): Promise<string> {
  const userId = missionControlUserId(claims.academyUserId);
  const now = new Date();
  const plan = entitlementPlan(claims);
  const status = entitlementStatus(claims);
  const currentPeriodStartsAt = parseCurrentPeriodStart(claims.currentPeriodStartsAt);
  const accessEndsAt = claims.currentPeriodEndsAt ?? claims.accessEndsAt ?? null;
  logHostedEvent("academy.entitlement_sync", {
    academyUserId: claims.academyUserId,
    userId,
    plan,
    status,
    missionControlHosted: claims.missionControlHosted,
    remoteRuntimeEnabled: claims.remoteRuntimeEnabled && claims.missionControlHosted,
    entitlementVersion: claims.entitlementVersion,
  });
  await getHostedPool().query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, NULL, $5, $5)
      ON CONFLICT ("id") DO UPDATE
      SET "email" = EXCLUDED."email",
        "emailVerified" = EXCLUDED."emailVerified",
        "updatedAt" = EXCLUDED."updatedAt"`,
    [userId, claims.email, claims.email, claims.emailVerified, now],
  );
  await getHostedPool().query(
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
        "updatedAt" = now()`,
    [
      `ent_${randomUUID()}`,
      userId,
      plan,
      status,
      claims.remoteRuntimeEnabled && claims.missionControlHosted,
      claims.billingStatus === "trialing" ? accessEndsAt : null,
      currentPeriodStartsAt,
      claims.billingStatus === "trialing" ? null : accessEndsAt,
    ],
  );
  await getHostedPool().query(
    `INSERT INTO "academyAccountLink" (
        "id", "userId", "academyUserId", "email", "emailVerified", "sourceTier",
        "billingStatus", "missionControlHosted", "remoteRuntimeEnabled",
        "lastSyncedAt", "lastAcademyEntitlementVersion", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, now(), now())
      ON CONFLICT ("academyUserId") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "email" = EXCLUDED."email",
        "emailVerified" = EXCLUDED."emailVerified",
        "sourceTier" = EXCLUDED."sourceTier",
        "billingStatus" = EXCLUDED."billingStatus",
        "missionControlHosted" = EXCLUDED."missionControlHosted",
        "remoteRuntimeEnabled" = EXCLUDED."remoteRuntimeEnabled",
        "lastSyncedAt" = EXCLUDED."lastSyncedAt",
        "lastAcademyEntitlementVersion" = EXCLUDED."lastAcademyEntitlementVersion",
        "updatedAt" = now()`,
    [
      `aal_${randomUUID()}`,
      userId,
      claims.academyUserId,
      claims.email,
      claims.emailVerified,
      claims.sourceTier ?? null,
      claims.billingStatus,
      claims.missionControlHosted,
      claims.remoteRuntimeEnabled && claims.missionControlHosted,
      claims.entitlementVersion ?? null,
    ],
  );
  return userId;
}

export async function createHostedSessionFromAcademy(
  request: Request,
  input: { code?: string; token?: string },
): Promise<{ cookie: string; claims: AcademyEntitlementClaims }> {
  if (!isHostedDatabaseEnabled()) throw new Error("DATABASE_URL is required for hosted sessions");
  const claims = await fetchAcademyClaims(request, input);
  if (!claims.missionControlHosted) {
    logHostedEvent("academy.hosted_access_denied", {
      academyUserId: claims.academyUserId,
      entitlementVersion: claims.entitlementVersion,
    }, "warn");
    throw new Error("Academy user is not entitled to hosted Mission Control");
  }
  const userId = await syncAcademyEntitlementClaims(claims);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlMinutes() * 60_000);
  await getHostedPool().query(
    `INSERT INTO "hostedSession" (
        "id", "userId", "academyUserId", "tokenHash", "expiresAt", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, now(), now())`,
    [`hs_${randomUUID()}`, userId, claims.academyUserId, tokenHash(token), expiresAt],
  );
  logHostedEvent("hosted_session.created", {
    academyUserId: claims.academyUserId,
    userId,
    expiresAt: expiresAt.toISOString(),
  });
  return {
    claims,
    cookie: serializeCookie(HOSTED_SESSION_COOKIE, token, {
      request,
      maxAgeSeconds: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    }),
  };
}

type RenewableSessionRow = {
  id: string;
  academyUserId: string;
  userId: string;
  expiresAt: Date | string;
};

export async function renewHostedSessionIfNeeded(request: Request): Promise<string | null> {
  if (!isHostedDatabaseEnabled()) return null;
  const token = cookieValue(request, HOSTED_SESSION_COOKIE);
  if (!token) return null;

  const result = await getHostedPool().query<RenewableSessionRow>(
    `SELECT "id", "academyUserId", "userId", "expiresAt"
      FROM "hostedSession"
      WHERE "tokenHash" = $1
        AND "revokedAt" IS NULL
        AND "expiresAt" > now()
      LIMIT 1`,
    [tokenHash(token)],
  );
  const session = result.rows[0];
  if (!session) return null;

  const expiresAtMs = new Date(session.expiresAt).getTime();
  const renewalWindowMs = sessionRenewalWindowMinutes() * 60_000;
  if (expiresAtMs - Date.now() > renewalWindowMs) return null;

  const nextToken = randomBytes(32).toString("hex");
  const nextExpiresAt = new Date(Date.now() + sessionTtlMinutes() * 60_000);
  await getHostedPool().query(
    `UPDATE "hostedSession"
      SET "tokenHash" = $2, "expiresAt" = $3, "updatedAt" = now()
      WHERE "id" = $1
        AND "revokedAt" IS NULL`,
    [session.id, tokenHash(nextToken), nextExpiresAt],
  );
  logHostedEvent("hosted_session.renewed", {
    sessionId: session.id,
    academyUserId: session.academyUserId,
    userId: session.userId,
    expiresAt: nextExpiresAt.toISOString(),
  });
  return serializeCookie(HOSTED_SESSION_COOKIE, nextToken, {
    request,
    maxAgeSeconds: Math.floor((nextExpiresAt.getTime() - Date.now()) / 1000),
  });
}

export async function revokeHostedSession(request: Request): Promise<void> {
  if (!isHostedDatabaseEnabled()) return;
  const token = cookieValue(request, HOSTED_SESSION_COOKIE);
  if (!token) return;
  await getHostedPool().query(
    `UPDATE "hostedSession"
      SET "revokedAt" = now(), "updatedAt" = now()
      WHERE "tokenHash" = $1 AND "revokedAt" IS NULL`,
    [tokenHash(token)],
  );
  logHostedEvent("hosted_session.revoked", { tokenPresent: true });
}
