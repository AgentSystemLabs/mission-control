import { ensureApiTokenBootstrap } from "./bootstrap";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function requireBearerToken(request: Request): { ok: true } | { ok: false; response: Response } {
  const expected = ensureApiTokenBootstrap();
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true };
}

// EventSource cannot set custom headers, so SSE endpoints accept the
// token via `?t=<token>` query string instead of Authorization.
export function requireTokenQueryParam(url: URL): { ok: true } | { ok: false; response: Response } {
  const expected = ensureApiTokenBootstrap();
  const token = (url.searchParams.get("t") || "").trim();
  if (!token || token !== expected) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true };
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
