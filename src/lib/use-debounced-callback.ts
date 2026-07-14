import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-debounced wrapper around a callback. The returned function keeps a
 * stable identity, always calls the latest `fn`, and fires once after calls
 * stop for `delayMs`. Pending timers are cleared on unmount.
 *
 * Pass `maxWait` to also guarantee a flush at most `maxWait` ms after the first
 * deferred call in a burst. Without it (the default) the wrapper is purely
 * trailing, so a continuous stream of calls spaced closer than `delayMs` defers
 * the flush indefinitely — under a sustained SSE event storm that starves the
 * refetch and the UI goes stale for as long as the storm lasts. `maxWait` bounds
 * that staleness while still coalescing: during a storm it flushes about once
 * per `maxWait` ms rather than once per event.
 *
 * Used to coalesce bursts of SSE-driven query invalidations: an agent doing
 * several tool calls in a second emits several `task:updated` events, and
 * without debouncing each one refetches the (heavy) projects list / tasks list.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
  maxWait?: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the first call in the current deferred burst; null between
  // bursts. Only consulted when maxWait is set.
  const firstCallRef = useRef<number | null>(null);
  const lastArgsRef = useRef<A | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    firstCallRef.current = null;
    const args = lastArgsRef.current;
    lastArgsRef.current = null;
    if (args) fnRef.current(...args);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      lastArgsRef.current = args;
      const now = Date.now();
      if (firstCallRef.current === null) firstCallRef.current = now;
      if (timerRef.current) clearTimeout(timerRef.current);
      let wait = delayMs;
      if (maxWait !== undefined) {
        // Clamp the trailing delay so the flush lands no later than maxWait ms
        // after the burst's first call, even if calls keep arriving.
        const remaining = maxWait - (now - firstCallRef.current);
        wait = Math.max(0, Math.min(delayMs, remaining));
      }
      timerRef.current = setTimeout(flush, wait);
    },
    [delayMs, maxWait, flush],
  );
}
