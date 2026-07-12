import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook only uses useRef / useCallback / useEffect. Mock React with
// single-render semantics: refs are plain mutable cells created once per hook
// call, useCallback returns its function verbatim, and useEffect runs the effect
// immediately while capturing its cleanup so a test can trigger unmount. This
// exercises the real implementation (timers, arg freshness, maxWait clamping,
// window reset) under fake timers with no DOM / renderer dependency.
const effectCleanups: Array<() => void> = [];
vi.mock("react", () => ({
  useRef: <T,>(init: T) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (typeof cleanup === "function") effectCleanups.push(cleanup);
  },
}));

// Imported after the mock is registered (vi.mock is hoisted above imports).
const { useDebouncedCallback } = await import("../use-debounced-callback");

function unmount() {
  while (effectCleanups.length) effectCleanups.pop()!();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe("useDebouncedCallback", () => {
  it("fires once, trailing, after calls stop for delayMs (no maxWait)", () => {
    const spy = vi.fn();
    const debounced = useDebouncedCallback(spy, 150);

    debounced("a");
    vi.advanceTimersByTime(100);
    debounced("b");
    vi.advanceTimersByTime(100); // 100ms since last call — still pending
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50); // 150ms since "b"
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith("b"); // newest args win
  });

  it("keeps deferring indefinitely under a sustained sub-delay stream without maxWait", () => {
    const spy = vi.fn();
    const debounced = useDebouncedCallback(spy, 150);

    for (let i = 0; i < 40; i++) {
      debounced(i);
      vi.advanceTimersByTime(50); // < delayMs, so the trailing timer never lands
    }
    expect(spy).not.toHaveBeenCalled(); // this is the starvation the fix targets
  });

  it("bounds staleness to ~maxWait during a sustained storm and coalesces", () => {
    const spy = vi.fn();
    const debounced = useDebouncedCallback(spy, 150, 400);

    // Fire every 50ms for 1000ms: 20 calls, none more than 50ms apart.
    for (let i = 0; i < 20; i++) {
      debounced(i);
      vi.advanceTimersByTime(50);
    }

    // Pure-trailing would still be starved here; maxWait forces periodic flushes.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // ...but far fewer than one-per-event (20): heavy coalescing.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
    // Each flush carries the freshest args seen at flush time (monotonic here).
    const seen = spy.mock.calls.map((c) => c[0] as number);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it("caps the first flush at maxWait after the burst's first call", () => {
    const spy = vi.fn();
    const debounced = useDebouncedCallback(spy, 150, 400);

    // Calls 100ms apart: pure trailing (150ms) would let each reset the timer,
    // so the first flush is driven by maxWait (~400ms), not delayMs.
    debounced(0);
    vi.advanceTimersByTime(100);
    debounced(1);
    vi.advanceTimersByTime(100);
    debounced(2);
    vi.advanceTimersByTime(100);
    debounced(3);
    expect(spy).not.toHaveBeenCalled(); // 300ms elapsed, under maxWait

    vi.advanceTimersByTime(100); // 400ms since first call
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(3);
  });

  it("resets the maxWait window after a flush", () => {
    const spy = vi.fn();
    const debounced = useDebouncedCallback(spy, 150, 400);

    debounced("first");
    vi.advanceTimersByTime(150); // trailing flush lands (no further calls)
    expect(spy).toHaveBeenCalledTimes(1);

    // A fresh burst should get its own full maxWait budget, not a stale one.
    debounced("second-a");
    vi.advanceTimersByTime(100);
    debounced("second-b");
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1); // only 200ms into the new window
    vi.advanceTimersByTime(50); // 150ms since last call -> trailing flush
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("second-b");
  });

  it("cancels a pending flush on unmount", () => {
    const spy = vi.fn();
    const debounced = useDebouncedCallback(spy, 150, 400);

    debounced("x");
    vi.advanceTimersByTime(50);
    unmount(); // effect cleanup clears the pending timer
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });
});
