import { ensureApiTokenBootstrap } from "../bootstrap";
import { jsonError } from "../auth";
import { serverEnv } from "~/shared/env";
import { ensurePostgresSchema, getPostgresDb } from "~/db/postgres";
import * as pgSchema from "~/db/pg-schema";

export type CloudUser = {
  id: string;
  email?: string | null;
};

export function isCloudMode(): boolean {
  const value = serverEnv().MC_CLOUD_MODE;
  return value === "1" || value === "true" || value === "yes";
}

function bearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

let authInstance: any = null;

function trustedOrigins(): string[] | undefined {
  const raw = serverEnv().BETTER_AUTH_TRUSTED_ORIGINS;
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getBetterAuth(): Promise<any> {
  if (authInstance) return authInstance;
  const [{ betterAuth }, { drizzleAdapter }] = await Promise.all([
    import("better-auth"),
    import("@better-auth/drizzle-adapter"),
  ]);
  const env = serverEnv();
  authInstance = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(getPostgresDb(), {
      provider: "pg",
      schema: pgSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      minPasswordLength: 8,
      autoSignIn: true,
    },
  });
  return authInstance;
}

export async function handleCloudAuthRequest(request: Request): Promise<Response> {
  await ensurePostgresSchema();
  return (await getBetterAuth()).handler(request);
}

export async function cloudUserFromRequest(request: Request): Promise<CloudUser | null> {
  if (!isCloudMode()) return { id: "local" };
  const cookie = request.headers.get("cookie") ?? "";
  if (!/(^|;\s*)(?:__Secure-)?better-auth\./.test(cookie)) return null;
  await ensurePostgresSchema();
  const session = await (await getBetterAuth()).api.getSession({
    headers: request.headers,
  });
  const user = session?.user;
  return user ? { id: user.id, email: user.email ?? null } : null;
}

export async function requireCloudUser(request: Request): Promise<{ ok: true; user: CloudUser } | { ok: false; response: Response }> {
  const user = await cloudUserFromRequest(request);
  if (!user) return { ok: false, response: jsonError(401, "unauthorized") };
  return { ok: true, user };
}

export async function requireAppAuth(request: Request): Promise<{ ok: true; user: CloudUser | null } | { ok: false; response: Response }> {
  if (isCloudMode()) return requireCloudUser(request);

  const expected = ensureApiTokenBootstrap();
  const token = bearerToken(request);
  if (token && token === expected) return { ok: true, user: null };
  return { ok: false, response: jsonError(401, "unauthorized") };
}
