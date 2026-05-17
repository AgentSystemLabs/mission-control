import { useEffect } from "react";
import { resolveApiToken } from "./api";

export type ServerEvent = { type: string; [k: string]: unknown };

// Backoff before reconnecting the SSE stream after a token miss or transient
// error. Same delay for both paths so reconnect cadence is predictable.
const SSE_RECONNECT_DELAY_MS = 1500;

export function useServerEvents(onEvent: (e: ServerEvent) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let es: EventSource | null = null;

    const connect = async () => {
      if (stopped) return;
      // EventSource cannot send Authorization headers; the bearer travels in
      // ?token= and is constant-time-compared server-side.
      const token = await resolveApiToken();
      if (stopped) return;
      if (!token) {
        setTimeout(() => void connect(), SSE_RECONNECT_DELAY_MS);
        return;
      }
      es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
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
        if (!stopped) setTimeout(() => void connect(), SSE_RECONNECT_DELAY_MS);
      };
    };

    void connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [onEvent]);
}
