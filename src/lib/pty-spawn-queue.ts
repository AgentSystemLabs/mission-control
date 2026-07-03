/**
 * Concurrency limiter for local agent PTY spawns.
 *
 * Opening the session grid mounts every pane at once; unthrottled, N agent
 * CLIs cold-boot simultaneously (each a full Node process) and the machine
 * grinds. `pty.spawn` itself returns as soon as the process forks, so limiting
 * the spawn call alone wouldn't stagger the load — instead each spawn HOLDS its
 * slot until the agent produces its first output (it's mostly booted by then)
 * or a settle timeout elapses, whichever comes first.
 *
 * The slot count scales with the machine: each cold boot pins roughly one core
 * (Node startup + JIT), so half the logical cores can boot agents while the
 * other half keeps the renderer, main process, and already-running agents
 * responsive. Clamped so a weak machine still makes progress two at a time and
 * a many-core machine doesn't stampede disk/memory with a dozen Node boots.
 */

const MIN_SPAWN_SLOTS = 2;
const MAX_SPAWN_SLOTS = 6;

/** Spawn slots for a machine with `cores` logical cores (half, clamped 2–6). */
export function spawnConcurrencyFor(cores: number | undefined): number {
  if (!cores || !Number.isFinite(cores) || cores < 1) return MIN_SPAWN_SLOTS;
  return Math.min(MAX_SPAWN_SLOTS, Math.max(MIN_SPAWN_SLOTS, Math.floor(cores / 2)));
}

let maxConcurrentSpawns = spawnConcurrencyFor(
  typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
);

/** Test-only: pin the slot count (returns the previous value). */
export function setSpawnConcurrencyForTests(n: number): number {
  const prev = maxConcurrentSpawns;
  maxConcurrentSpawns = n;
  return prev;
}

/** Slot is released this long after spawn even if the agent stays silent. */
export const SPAWN_SETTLE_MS = 2_500;

let active = 0;
const waiters: Array<() => void> = [];

/**
 * Wait for a spawn slot. Resolves to a release function; callers MUST call it
 * exactly once (calling it again is a no-op) when the spawned agent has
 * settled — on first PTY output, on spawn failure, or on teardown.
 */
export async function acquireSpawnSlot(): Promise<() => void> {
  if (active < maxConcurrentSpawns) {
    active += 1;
  } else {
    // The releaser hands its slot to us directly (active stays counted), so a
    // fresh acquirer can't slip in between the release and this wake-up.
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
