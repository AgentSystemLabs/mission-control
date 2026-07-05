import { useEffect } from "react";
import { api, ApiError } from "./api";

export type ServerEvent = { type: string; [k: string]: unknown };

// Backoff before reconnecting the SSE stream after a transient error.
const SSE_RECONNECT_DELAY_MS = 1500;

// A SINGLE shared EventSource fans every server event out to all in-renderer
// listeners. Each useServerEvents() call used to open its own EventSource (and
// fetch its own single-use ticket), so a route with several subscribers held
// several duplicate SSE connections and delivered every event once per
// subscriber, each doing overlapping query invalidations. Now there is one
// socket, one ticket, and N cheap in-process listeners.
type Listener = (e: ServerEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(): void {
  if (reconnectTimer !== null || listeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, SSE_RECONNECT_DELAY_MS);
}

async function connect(): Promise<void> {
  if (typeof window === "undefined") return;
  // Guards are synchronous up to `connecting = true`, so concurrent callers in
  // the same tick can't open two sockets.
  if (source || connecting || listeners.size === 0) return;
  connecting = true;

  // EventSource cannot send Authorization headers, so fetch a short-lived
  // single-use ticket over the normal bearer-authenticated API first.
  let ticket: string;
  try {
    ({ ticket } = await api.createEventsTicket());
  } catch (err) {
    connecting = false;
    // Unauthenticated: don't hammer — a later subscribe (e.g. after login)
    // retries connect().
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return;
    scheduleReconnect();
    return;
  }
  if (listeners.size === 0) {
    connecting = false;
    return;
  }

  const es = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
  source = es;
  connecting = false;
  es.onmessage = (msg) => {
    let data: ServerEvent;
    try {
      data = JSON.parse(msg.data);
    } catch {
      return;
    }
    // Snapshot so a listener that (un)subscribes during dispatch can't mutate
    // the set mid-iteration; isolate a throwing listener from the rest.
    for (const listener of [...listeners]) {
      try {
        listener(data);
      } catch {
        /* swallow */
      }
    }
  };
  es.onerror = () => {
    es.close();
    if (source === es) source = null;
    scheduleReconnect();
  };
}

function closeIfIdle(): void {
  if (listeners.size > 0) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  source?.close();
  source = null;
}

export function useServerEvents(onEvent: (e: ServerEvent) => void) {
  useEffect(() => {
    listeners.add(onEvent);
    void connect();
    return () => {
      listeners.delete(onEvent);
      closeIfIdle();
    };
  }, [onEvent]);
}
