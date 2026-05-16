import { events } from "../events";

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
      }, 15_000);
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
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
