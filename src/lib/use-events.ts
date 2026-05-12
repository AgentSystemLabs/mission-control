import { useEffect } from "react";
import { getCachedApiToken } from "./api";

export type ServerEvent = { type: string; [k: string]: unknown };

async function waitForToken(): Promise<string | null> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const t = getCachedApiToken();
    if (t) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

export function useServerEvents(onEvent: (e: ServerEvent) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let es: EventSource | null = null;

    const connect = async () => {
      if (stopped) return;
      const token = await waitForToken();
      if (stopped) return;
      const url = token ? `/api/events?t=${encodeURIComponent(token)}` : "/api/events";
      es = new EventSource(url);
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
        if (!stopped) setTimeout(() => void connect(), 1500);
      };
    };

    void connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [onEvent]);
}
