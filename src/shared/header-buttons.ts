// Which discretionary buttons the app chrome shows — the top bar's tools and
// notifications, and the project header's per-project actions. Like the session
// header buttons, every one of these has a keyboard shortcut (or another entry
// point), so a user who leans on the hotkeys can hide it for quieter chrome.
// Each key is hideable in place (right-click → Hide, see `useHideableMenu`) and
// toggleable in Settings → Interface — both drive this same map.
//
// The structural chrome (settings, project picker, scope dropdown, ship/changes
// controls) is intentionally NOT listed here: those have no hotkey-only path,
// so hiding them would strand the action.

export const HEADER_BUTTON_KEYS = [
  "scratchPad",
  "promptSearch",
  "voice",
  "notifications",
  "screenshot",
  "gridView",
  "fileFinder",
] as const;

export type HeaderButtonKey = (typeof HEADER_BUTTON_KEYS)[number];

export type HeaderButtonVisibility = Record<HeaderButtonKey, boolean>;

export const DEFAULT_HEADER_BUTTON_VISIBILITY: HeaderButtonVisibility = {
  scratchPad: true,
  promptSearch: true,
  voice: true,
  notifications: true,
  screenshot: true,
  gridView: true,
  fileFinder: true,
};

/**
 * Coerce an arbitrary stored/received value into a complete visibility map,
 * merging any recognized boolean keys over the defaults. Unknown keys and
 * non-boolean values are ignored so a stale or partial payload degrades to the
 * defaults rather than throwing.
 */
export function normalizeHeaderButtonVisibility(value: unknown): HeaderButtonVisibility {
  const next: HeaderButtonVisibility = { ...DEFAULT_HEADER_BUTTON_VISIBILITY };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of HEADER_BUTTON_KEYS) {
      if (typeof record[key] === "boolean") next[key] = record[key];
    }
  }
  return next;
}
