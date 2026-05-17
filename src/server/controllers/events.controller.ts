import { events } from "../events";
import { HTTP_OK } from "~/shared/http-status";

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
      // no-store: the request URL carries the bearer in ?token=; keep it out
      // of any cache layer (browser disk cache, bfcache, intermediaries).
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
