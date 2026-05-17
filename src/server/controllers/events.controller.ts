import { randomBytes } from "node:crypto";
import { json, jsonError } from "../auth";
import { events } from "../events";
import { HTTP_OK, HTTP_UNAUTHORIZED } from "~/shared/http-status";

const SSE_TICKET_TTL_MS = 30_000;
const SSE_TICKET_BYTES = 32;
const sseTickets = new Map<string, number>();

function unauthorized(): { ok: false; response: Response } {
  return { ok: false, response: jsonError(HTTP_UNAUTHORIZED, "unauthorized") };
}

function pruneExpiredTickets(now = Date.now()): void {
  for (const [ticket, expiresAt] of sseTickets) {
    if (expiresAt <= now) sseTickets.delete(ticket);
  }
}

export function issueTicket(): Response {
  pruneExpiredTickets();
  const ticket = randomBytes(SSE_TICKET_BYTES).toString("hex");
  const expiresAt = Date.now() + SSE_TICKET_TTL_MS;
  sseTickets.set(ticket, expiresAt);
  return json({ ticket, expiresAt });
}

export function requireTicket(
  rawTicket: string | null | undefined,
): { ok: true } | { ok: false; response: Response } {
  const now = Date.now();
  pruneExpiredTickets(now);
  const ticket = (rawTicket ?? "").trim();
  if (!ticket) return unauthorized();

  const expiresAt = sseTickets.get(ticket);
  sseTickets.delete(ticket);
  if (!expiresAt || expiresAt <= now) return unauthorized();
  return { ok: true };
}

const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export function stream(): Response {
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
      const off = events.onAny((e) => send(e));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          /* swallow */
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
      (controller as any)._mc_cleanup = () => {
        clearInterval(heartbeat);
        off();
      };
    },
    cancel() {
      const cleanup = (this as any)._mc_cleanup as undefined | (() => void);
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
