// Which discretionary buttons the session (terminal) pane header shows. These
// are the actions that also have keyboard shortcuts, so users who lean on the
// hotkeys can hide them for a cleaner header. Zoom is hidden by default — most
// people drive it with Cmd/Ctrl +/-/0. The structural Expand/Shrink and Close
// controls are intentionally NOT toggleable here; they stay in the header (or
// the "…" overflow menu on narrow panes) so a pane can always be managed.

export const SESSION_HEADER_BUTTON_KEYS = ["rename", "zoom", "clone", "focus"] as const;

export type SessionHeaderButtonKey = (typeof SESSION_HEADER_BUTTON_KEYS)[number];

export type SessionHeaderButtonVisibility = Record<SessionHeaderButtonKey, boolean>;

export const DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY: SessionHeaderButtonVisibility = {
  rename: true,
  zoom: false,
  clone: true,
  focus: true,
};

/**
 * Coerce an arbitrary stored/received value into a complete visibility map,
 * merging any recognized boolean keys over the defaults. Unknown keys and
 * non-boolean values are ignored so a stale or partial payload degrades to the
 * defaults rather than throwing.
 */
export function normalizeSessionHeaderButtonVisibility(
  value: unknown,
): SessionHeaderButtonVisibility {
  const next: SessionHeaderButtonVisibility = { ...DEFAULT_SESSION_HEADER_BUTTON_VISIBILITY };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of SESSION_HEADER_BUTTON_KEYS) {
      if (typeof record[key] === "boolean") next[key] = record[key];
    }
  }
  return next;
}
