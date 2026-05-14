import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../shared/logger";

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
        } catch (err: unknown) {
          logger.error("vite api middleware failed", {
            err,
            route: pathnameFromRequestUrl(req.url),
            method: req.method,
          });
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Internal server error", code: "internal_error" }));
        }
      });
    },
  };
}

function pathnameFromRequestUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return "";
  }
}

async function nodeRequestToFetch(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || "127.0.0.1";
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
    res.setHeader(key, value);
  });

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

   
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) await flush(value);
  }
  res.end();
}
