import { randomBytes } from "node:crypto";
import { json, jsonError } from "../auth";
import { events } from "../events";
import { HTTP_OK, HTTP_UNAUTHORIZED } from "~/shared/http-status";

const SSE_TICKET_TTL_MS = 30_000;
const SSE_TICKET_BYTES = 32;
const sseTickets = new Map<string, { expiresAt: number }>();

function pruneExpiredTickets(now = Date.now()): void {
  for (const [ticket, entry] of sseTickets) {
    if (entry.expiresAt <= now) sseTickets.delete(ticket);
  }
}

export function issueTicket(): Response {
  pruneExpiredTickets();
  const ticket = randomBytes(SSE_TICKET_BYTES).toString("hex");
  const expiresAt = Date.now() + SSE_TICKET_TTL_MS;
  sseTickets.set(ticket, { expiresAt });
  return json({ ticket, expiresAt });
}

function consumeTicket(rawTicket: string | null | undefined): boolean {
  const now = Date.now();
  pruneExpiredTickets(now);
  const ticket = (rawTicket ?? "").trim();
  if (!ticket) return false;

  const entry = sseTickets.get(ticket);
  sseTickets.delete(ticket);
  if (!entry || entry.expiresAt <= now) return false;
  return true;
}

const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export function stream(url: URL): Response {
  if (!consumeTicket(url.searchParams.get("ticket"))) {
    return jsonError(HTTP_UNAUTHORIZED, "unauthorized");
  }

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
