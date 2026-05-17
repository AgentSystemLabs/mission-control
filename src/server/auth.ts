import { timingSafeEqual } from "node:crypto";
import { getOrCreateApiToken } from "./services/settings";
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from "~/shared/http-status";

/**
 * Server-only accessor for the bearer token. SSR-side `req<T>` in
 * src/lib/api.ts dynamic-imports this so its loopback fetches can
 * authenticate. We deliberately avoid seeding `process.env.MC_API_TOKEN`
 * here — that would widen the token's blast radius to every child
 * process that inherits `process.env` (git, claude-cli, etc.); only the
 * PTYs that explicitly need the token receive it via the curated
 * `mcEnv` map in electron/pty-manager.ts.
 */
export function getServerApiToken(): string {
  return getOrCreateApiToken();
}

// Constant-time compare so the loopback HTTP server doesn't leak a per-byte
// timing oracle to other local processes — relevant because the bearer is now
// the sole HTTP authenticator after todos/bugs/done/02-... closed the GET leak.
function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const UNAUTHORIZED: Response = new Response(JSON.stringify({ error: "unauthorized" }), {
  status: HTTP_UNAUTHORIZED,
  headers: { "content-type": "application/json" },
});

function unauthorized(): { ok: false; response: Response } {
  // Clone so the body stream is fresh for every caller.
  return { ok: false, response: UNAUTHORIZED.clone() };
}

/**
 * Check a raw token value already extracted from an Authorization header
 * against the stored API bearer.
 */
export function requireBearerTokenValue(
  rawToken: string | null | undefined,
): { ok: true } | { ok: false; response: Response } {
  const expected = getOrCreateApiToken();
  const token = (rawToken ?? "").trim();
  if (!token || !tokensEqual(token, expected)) return unauthorized();
  return { ok: true };
}

export function requireBearerToken(request: Request): { ok: true } | { ok: false; response: Response } {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return requireBearerTokenValue(token);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function hostnameFromHostHeader(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const bracketed = trimmed.match(/^\[([^\]]+)\]/);
  if (bracketed) return bracketed[1] ?? null;
  const colonIdx = trimmed.indexOf(":");
  return colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx);
}

function hostnameFromOrigin(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Reject cross-origin browser fetches and DNS-rebinding attacks against the
 * local API server. Browsers send `Origin` on every cross-origin request and
 * always send `Host` over HTTP/1.1; rebinding can route traffic to 127.0.0.1
 * but cannot forge either header from page JS, so a loopback-only allowlist
 * on both shuts the class down. `Origin: null` (sandboxed iframes, data: URIs)
 * is treated as untrusted so a sandboxed page on a victim site can't ride in
 * on a loopback Host.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === "null") return false;
    return isLoopback(hostnameFromOrigin(origin));
  }
  const host = request.headers.get("host");
  if (host) {
    return isLoopback(hostnameFromHostHeader(host));
  }
  try {
    return isLoopback(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function requireLocalOrigin(
  request: Request,
): { ok: true } | { ok: false; response: Response } {
  if (isSameOriginRequest(request)) return { ok: true };
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "forbidden" }), {
      status: HTTP_FORBIDDEN,
      headers: { "content-type": "application/json" },
    }),
  };
}

export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}
