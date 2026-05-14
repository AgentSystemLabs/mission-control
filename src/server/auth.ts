import { ensureApiTokenBootstrap } from "./bootstrap";
export { json, jsonError } from "./lib/api-response";

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
