import type { TaskAgent } from "~/shared/domain";

// Per-scope "sessions per row" lock for the session grid. Stored beside the
// grid's layout blobs (same per-scope keying) so each project/worktree/runtime
// scope keeps its own row width. `null` means auto — the grid keeps its
// historical behavior (near-square seeding, rows grow as sessions land in
// them). A number caps how many cells a *new* session may join a row with:
// the grid fills the current row up to the cap, then flows into the next row
// with space, then opens a fresh row. Manual drag-reordering is deliberately
// not policed by the cap — the lock governs placement, not the user's hands.
const GRID_COLUMNS_PREFIX = "mc.gridColumns";

/** Row widths offered by the layout dropdown (and accepted from storage). */
export const GRID_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
export const MAX_GRID_COLUMNS = 6;

/** Fired (on window) after a scope's column limit changes, so the grid and the
 *  header dropdown — which don't share React state — both re-read storage. */
export const GRID_PREFS_EVENT = "mc:grid-prefs-changed";
export type GridPrefsEventDetail = { scopeKey: string };

/** One-shot "sort the grid by agent" command from the header dropdown to the
 *  mounted SessionGrid (same window-event bridge as GRID_EXPAND_TOGGLE_EVENT). */
export const GRID_SORT_EVENT = "mc:grid-sort";
export type GridSortEventDetail = { scopeKey: string; firstAgent: TaskAgent };

function columnsStorageKey(scopeKey: string): string {
  return `${GRID_COLUMNS_PREFIX}:${scopeKey}`;
}

/** Valid stored limit (1..MAX_GRID_COLUMNS), or null for auto/malformed. */
function sanitizeLimit(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_GRID_COLUMNS
    ? value
    : null;
}

export function loadGridColumnLimit(scopeKey: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(columnsStorageKey(scopeKey));
    if (!raw) return null;
    return sanitizeLimit(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveGridColumnLimit(scopeKey: string, limit: number | null): void {
  if (typeof window === "undefined") return;
  const next = sanitizeLimit(limit);
  try {
    if (next === null) {
      window.localStorage.removeItem(columnsStorageKey(scopeKey));
    } else {
      window.localStorage.setItem(columnsStorageKey(scopeKey), JSON.stringify(next));
    }
  } catch {
    /* quota or disabled */
  }
  window.dispatchEvent(
    new CustomEvent<GridPrefsEventDetail>(GRID_PREFS_EVENT, { detail: { scopeKey } }),
  );
}

export function requestGridSort(scopeKey: string, firstAgent: TaskAgent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GridSortEventDetail>(GRID_SORT_EVENT, {
      detail: { scopeKey, firstAgent },
    }),
  );
}

/** Announced when the session.gridLayout quick picker opens, so the header's
 *  layout dropdown closes instead of stacking a second popup over it (the
 *  reverse needs no event — opening the dropdown is an outside pointerdown,
 *  which already dismisses the picker). */
export const GRID_QUICK_PICKER_EVENT = "mc:grid-quick-picker-open";

export function announceGridQuickPickerOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GRID_QUICK_PICKER_EVENT));
}
