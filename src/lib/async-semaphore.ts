/**
 * A counting semaphore for async work. `acquire()` resolves once a slot is
 * free, returning a release function the caller MUST invoke exactly once
 * (repeats are no-ops) when its work is done — including on error/teardown.
 *
 * `getMax` is read at acquire time, so callers can vary the limit at runtime
 * (e.g. rescale on hardware, or pin it in tests). Pass `() => 1` for a plain
 * mutex. The releaser hands its slot directly to the next waiter (the count
 * stays occupied across the handoff), so a fresh acquirer can't slip in between
 * a release and the wake-up.
 */
export function createAsyncSemaphore(getMax: () => number): { acquire: () => Promise<() => void> } {
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<() => void> {
    if (active < getMax()) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    };
  }

  return { acquire };
}
