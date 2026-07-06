/**
 * A minimal subscribe/notify listener set — the reusable core of a hand-rolled
 * external store (the `subscribe` half of React's `useSyncExternalStore`).
 * `subscribe` registers a listener and returns its unsubscribe function;
 * `notify` invokes every currently-registered listener. Each store keeps its
 * own snapshot state and just borrows this pub/sub primitive.
 */
export function createListenerSet(): {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}
