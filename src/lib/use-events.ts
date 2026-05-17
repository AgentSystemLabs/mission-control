import { useEffect } from "react";
import { api } from "./api";

export type ServerEvent = { type: string; [k: string]: unknown };

// Backoff before reconnecting the SSE stream after a token miss or transient
// error. Same delay for both paths so reconnect cadence is predictable.
const SSE_RECONNECT_DELAY_MS = 1500;

export function useServerEvents(onEvent: (e: ServerEvent) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let es: EventSource | null = null;
    const reconnect = () => {
      if (!stopped) setTimeout(() => void connect(), SSE_RECONNECT_DELAY_MS);
    };

    const connect = async () => {
      if (stopped) return;
      // EventSource cannot send Authorization headers, so fetch a short-lived
      // single-use ticket over the normal bearer-authenticated API first.
      let ticket: string;
      try {
        ({ ticket } = await api.createEventsTicket());
      } catch {
        reconnect();
        return;
      }
      if (stopped) return;
      es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          onEvent(data);
        } catch {
          /* swallow */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        reconnect();
      };
    };

    void connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [onEvent]);
}
