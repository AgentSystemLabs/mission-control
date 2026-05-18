import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HTTP_INTERNAL_SERVER_ERROR } from "../shared/http-status";

const LOOPBACK_HOST_FALLBACK = "127.0.0.1";
const TOKEN_QUERY_REDACT_URL = /([?&])token=[^&#]+/gi;
const TOKEN_QUERY_REDACT_MESSAGE = /([?&])token=[^&#\s"']+/gi;
const TOKEN_REDACTED_REPLACEMENT = "$1token=<redacted>";

/**
 * Vite plugin that mounts the MissionControl `/api/*` Web-fetch handler
 * as a Connect middleware. Lazy-imports the handler so Vite's SSR
 * boundary keeps better-sqlite3 / native bindings on the Node side.
 */
export function missionControlApi(): Plugin {
  return {
    name: "mission-control-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();
        try {
          const { handleApiRequest } = await server.ssrLoadModule(
            "/src/server/api-router.ts"
          );
          const request = await nodeRequestToFetch(req);
          const response: Response | null = await (handleApiRequest as any)(request);
          if (!response) return next();
          await writeFetchResponse(response, res);
        } catch (err: any) {
          // Never echo err.message — it may contain the `?token=` SSE bearer
          // if the throw wrapped a URL. Generic body + redacted server log.
          const safeUrl = (req.url ?? "").replace(
            TOKEN_QUERY_REDACT_URL,
            TOKEN_REDACTED_REPLACEMENT,
          );
          const safeMessage = String(err?.message ?? "internal error").replace(
            TOKEN_QUERY_REDACT_MESSAGE,
            TOKEN_REDACTED_REPLACEMENT,
          );
          // eslint-disable-next-line no-console
          console.error(`[mc-api] ${req.method} ${safeUrl} failed: ${safeMessage}`);
          res.statusCode = HTTP_INTERNAL_SERVER_ERROR;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "internal error" }));
        }
      });
    },
  };
}

async function nodeRequestToFetch(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || LOOPBACK_HOST_FALLBACK;
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const vv of v) headers.append(k, vv);
    } else if (typeof v === "string") {
      headers.set(k, v);
    }
  }
  const method = (req.method || "GET").toUpperCase();
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const buf = await readBody(req);
    if (buf.byteLength > 0) {
      init.body = buf as BodyInit;
    }
  }
  return new Request(url, init);
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

async function writeFetchResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  const setCookies = getSetCookieHeaders(response.headers);
  if (setCookies.length) res.setHeader("set-cookie", setCookies);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const flush = (chunk: Uint8Array) =>
    new Promise<void>((resolve) => {
      const ok = res.write(chunk);
      if (ok) resolve();
      else res.once("drain", () => resolve());
    });

  res.on("close", () => reader.cancel().catch(() => undefined));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) await flush(value);
  }
  res.end();
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.();
  if (values?.length) return values;
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
}
