import { createHash } from "node:crypto";
import { getHostedPool, isHostedDatabaseEnabled } from "./hosted-pg";
import { logHostedEvent } from "./services/hosted-logs";

export const HOSTED_SESSION_COOKIE = "mc_session";

export type HostedAuthContext = {
  sessionId: string;
  academyUserId: string;
  userId: string;
  email: string;
  organizationId: string | null;
};

type HostedSessionRow = {
  id: string;
  academyUserId: string;
  userId: string;
  email: string;
};

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

export async function getHostedAuthContext(
  request: Request,
): Promise<HostedAuthContext | null> {
  if (!isHostedDatabaseEnabled()) return null;
  const token = cookieValue(request, HOSTED_SESSION_COOKIE);
  if (!token) {
    logHostedEvent("hosted_auth.missing_session_cookie");
    return null;
  }

  const result = await getHostedPool().query<HostedSessionRow>(
    `SELECT s."id", s."academyUserId", s."userId", u."email"
      FROM "hostedSession" s
      INNER JOIN "user" u ON u."id" = s."userId"
      WHERE s."tokenHash" = $1
        AND s."revokedAt" IS NULL
        AND s."expiresAt" > now()
      LIMIT 1`,
    [tokenHash(token)],
  );
  const session = result.rows[0];
  if (!session) {
    logHostedEvent("hosted_auth.invalid_session", {}, "warn");
    return null;
  }

  logHostedEvent("hosted_auth.session_authenticated", {
    sessionId: session.id,
    academyUserId: session.academyUserId,
    userId: session.userId,
  });

  return {
    sessionId: session.id,
    academyUserId: session.academyUserId,
    userId: session.userId,
    email: session.email,
    // Personal workspaces are the default until org membership lands.
    organizationId: null,
  };
}
