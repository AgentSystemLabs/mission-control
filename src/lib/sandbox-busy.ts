// Per-sandbox transient busy state for cloud lifecycle actions (pause / teardown).
// Keyed by sandbox id so each sandbox's controls gate ONLY on its own state —
// stopping one sandbox never disables another's stop button, and multiple
// sandboxes can be stopped concurrently. (Used by ScopeDropdown.)

export type SandboxBusyState = "pausing" | "destroying";
export type SandboxBusyMap = Record<string, SandboxBusyState>;

/**
 * Set or clear a single sandbox's busy state, leaving every other entry intact.
 * Returns the same reference when clearing an absent id, so it's a no-op render.
 */
export function setSandboxBusyState(
  prev: SandboxBusyMap,
  id: string,
  state: SandboxBusyState | null,
): SandboxBusyMap {
  if (state === null) {
    if (prev[id] === undefined) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  }
  return { ...prev, [id]: state };
}
