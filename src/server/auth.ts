import { getOrCreateApiToken } from "./services/settings";

export function requireBearerToken(request: Request): { ok: true } | { ok: false; response: Response } {
  const expected = getOrCreateApiToken();
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { ok: true };
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
      status: 403,
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
