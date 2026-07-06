import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-debounced wrapper around a callback. The returned function keeps a
 * stable identity, always calls the latest `fn`, and fires once after calls
 * stop for `delayMs`. Pending timers are cleared on unmount.
 *
 * Used to coalesce bursts of SSE-driven query invalidations: an agent doing
 * several tool calls in a second emits several `task:updated` events, and
 * without debouncing each one refetches the (heavy) projects list / tasks list.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
