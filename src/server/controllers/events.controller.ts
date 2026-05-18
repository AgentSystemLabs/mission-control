import { randomBytes } from "node:crypto";
import { json, jsonError } from "../auth";
import { eventVisibleToScope, events, scopeForHostedContext, type AppEventScope } from "../events";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";
import { HTTP_OK, HTTP_UNAUTHORIZED } from "~/shared/http-status";

const SSE_TICKET_TTL_MS = 30_000;
const SSE_TICKET_BYTES = 32;
const sseTickets = new Map<string, { expiresAt: number; scope: AppEventScope | null }>();

function unauthorized(): { ok: false; response: Response } {
  return { ok: false, response: jsonError(HTTP_UNAUTHORIZED, "unauthorized") };
}

function pruneExpiredTickets(now = Date.now()): void {
  for (const [ticket, entry] of sseTickets) {
    if (entry.expiresAt <= now) sseTickets.delete(ticket);
  }
}

async function scopeForRequest(request: Request): Promise<AppEventScope | null | undefined> {
  if (!isHostedDatabaseEnabled() || isElectronLocalApiRequest(request)) return null;
  const context = await getHostedAuthContext(request);
  return context ? scopeForHostedContext(context) : undefined;
}

export async function issueTicket(request: Request): Promise<Response> {
  pruneExpiredTickets();
  const scope = await scopeForRequest(request);
  if (scope === undefined) return unauthorized().response;
  const ticket = randomBytes(SSE_TICKET_BYTES).toString("hex");
  const expiresAt = Date.now() + SSE_TICKET_TTL_MS;
  sseTickets.set(ticket, { expiresAt, scope });
  return json({ ticket, expiresAt });
}

function consumeTicket(rawTicket: string | null | undefined): AppEventScope | null | undefined {
  const now = Date.now();
  pruneExpiredTickets(now);
  const ticket = (rawTicket ?? "").trim();
  if (!ticket) return undefined;

  const entry = sseTickets.get(ticket);
  sseTickets.delete(ticket);
  if (!entry || entry.expiresAt <= now) return undefined;
  return entry.scope;
}

const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export function stream(url: URL): Response {
  const scope = consumeTicket(url.searchParams.get("ticket"));
  if (scope === undefined) return unauthorized().response;

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* swallow */
        }
      };
      send({ type: "hello", at: Date.now() });
      const off = events.onAny((e) => {
        if (scope && !eventVisibleToScope(e, scope)) return;
        send(e);
      });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          /* swallow */
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        off();
      };
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    status: HTTP_OK,
    headers: {
      "content-type": "text/event-stream",
      // no-store: the request URL carries a short-lived SSE ticket; keep it out
      // of any cache layer (browser disk cache, bfcache, intermediaries).
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
