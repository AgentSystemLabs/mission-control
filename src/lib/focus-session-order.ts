// Smart, activity-based ordering for the Focus Mode session bar.
//
// The bar lists every open session and keeps the most-recently-*active* one at
// the front. "Active" means a meaningful task update — a status transition (AI
// started responding, finished, needs input, interrupted, errored, ...). Those
// transitions already stream in over SSE, so ordering costs nothing extra (no
// PTY taps). Manual tab switching deliberately does NOT reorder: a tab must
// never jump out from under the pointer that just clicked it.
//
// This module is pure so the reordering rules are unit-testable; the React glue
// (refs + state) lives in the /focus route.

export type SessionSnapshot = { taskId: string; status: string };

export type FocusOrderState = {
  /** Task ids, most-recently-active first. */
  order: string[];
  /** Last-seen status per task id, used to detect transitions. */
  status: Record<string, string>;
  /** Task ids with an update the user hasn't looked at yet. Never the active tab. */
  unread: string[];
};

export const emptyFocusOrderState: FocusOrderState = {
  order: [],
  status: {},
  unread: [],
};

/**
 * Fold the latest session snapshot into the ordering state.
 *
 * - New sessions and sessions whose status changed since the last reconcile are
 *   "activated": they move to the front (preserving their relative order within
 *   `sessions`) and, unless they are the active tab, gain an unread marker.
 * - Removed sessions drop out of order / status / unread.
 * - The active tab is always cleared of its unread marker.
 * - The very first fold (no prior status seen) is a baseline: sessions keep
 *   their incoming order — except the entered session (activeTaskId), which
 *   leads, so opening focus mode puts the focused session in the first tab.
 *   Nothing is marked unread on this fold, so opening doesn't light up tabs.
 * - After that first fold, a manual tab switch never reorders (only status
 *   transitions hoist a session): the clicked tab highlights where it sits.
 */
export function reconcileFocusOrder(
  prev: FocusOrderState,
  sessions: SessionSnapshot[],
  activeTaskId: string | null,
): FocusOrderState {
  const ids = sessions.map((s) => s.taskId);
  const idSet = new Set(ids);
  const isInitial = prev.order.length === 0 && Object.keys(prev.status).length === 0;

  const activated = new Set<string>();
  if (!isInitial) {
    for (const s of sessions) {
      const seen = prev.status[s.taskId];
      if (seen === undefined || seen !== s.status) activated.add(s.taskId);
    }
  }

  // Keep prior order for untouched sessions; hoist activated ones to the front
  // in their current-snapshot order (stable and deterministic). On the initial
  // fold there is no prior order, so lead with the entered session instead.
  const base = prev.order.filter((id) => idSet.has(id) && !activated.has(id));
  const front = ids.filter((id) => activated.has(id));
  const order = isInitial ? hoistFirst(ids.slice(), activeTaskId) : [...front, ...base];
  // Safety net: cover any id somehow missing from `order`.
  const covered = new Set(order);
  for (const id of ids) if (!covered.has(id)) order.push(id);

  const status: Record<string, string> = {};
  for (const s of sessions) status[s.taskId] = s.status;

  const unread = new Set(prev.unread.filter((id) => idSet.has(id)));
  for (const id of activated) {
    if (id !== activeTaskId) unread.add(id);
  }
  if (activeTaskId !== null) unread.delete(activeTaskId);

  return { order, status, unread: [...unread] };
}

/**
 * Project the reconciled order onto the live session list. Any session not yet
 * folded into `order` (a brand-new one, before the next reconcile bubbles it to
 * the front) is appended so it still shows immediately.
 */
export function orderSessions<T extends { taskId: string }>(
  sessions: T[],
  order: string[],
): T[] {
  const byId = new Map(sessions.map((s) => [s.taskId, s]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const s = byId.get(id);
    if (s && !seen.has(id)) {
      out.push(s);
      seen.add(id);
    }
  }
  for (const s of sessions) {
    if (!seen.has(s.taskId)) out.push(s);
  }
  return out;
}

/** Move `first` to the front of an id list, preserving the rest. */
function hoistFirst(ids: string[], first: string | null): string[] {
  if (!first) return ids;
  const i = ids.indexOf(first);
  if (i <= 0) return ids;
  return [first, ...ids.slice(0, i), ...ids.slice(i + 1)];
}
