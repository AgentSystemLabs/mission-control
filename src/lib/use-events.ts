import { useEffect } from "react";

export type ServerEvent = { type: string; [k: string]: unknown };

export function useServerEvents(onEvent: (e: ServerEvent) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let es: EventSource | null = null;

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events");
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
        if (!stopped) setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [onEvent]);
}
