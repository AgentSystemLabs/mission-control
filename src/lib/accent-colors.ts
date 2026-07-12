export type AccentColorId =
  | "deep-orange"
  | "terracotta"
  | "blue"
  | "green"
  | "teal"
  | "cyan"
  | "purple"
  | "magenta"
  | "pink"
  | "red"
  | "amber"
  | "lime"
  | "indigo"
  | "slate";

export type AccentColor = {
  id: AccentColorId;
  name: string;
  value: string;
  rgb: string;
  /** Ink for text/icons sitting ON the solid accent fill (e.g. the Ship /
   *  primary buttons in the flat theme). Bright accents take dark ink; the
   *  darker, saturated accents (blue/indigo/purple/red) take light ink, where
   *  near-black reads as muddy even though its raw contrast ratio passes. */
  onAccent: string;
};

// On-accent ink options. Dark is the near-black used across the flat theme;
// light is plain white for accents where dark ink reads unclear.
const ON_ACCENT_DARK = "#050607";
const ON_ACCENT_LIGHT = "#ffffff";

export const DEFAULT_ACCENT_COLOR: AccentColorId = "deep-orange";

export const ACCENT_COLORS: AccentColor[] = [
  { id: "deep-orange", name: "Deep orange", value: "#ff5a1f", rgb: "255, 90, 31", onAccent: ON_ACCENT_DARK },
  // Warm terracotta-amber sampled from the ember reference (the focused pane's
  // border + cursor). Ember defaults to this; any theme can use it.
  { id: "terracotta", name: "Terracotta", value: "#d0854e", rgb: "208, 133, 78", onAccent: ON_ACCENT_DARK },
  { id: "blue", name: "Blue", value: "#3b82f6", rgb: "59, 130, 246", onAccent: ON_ACCENT_LIGHT },
  { id: "green", name: "Green", value: "#22c55e", rgb: "34, 197, 94", onAccent: ON_ACCENT_DARK },
  { id: "teal", name: "Teal", value: "#14b8a6", rgb: "20, 184, 166", onAccent: ON_ACCENT_DARK },
  { id: "cyan", name: "Cyan", value: "#06b6d4", rgb: "6, 182, 212", onAccent: ON_ACCENT_DARK },
  { id: "purple", name: "Purple", value: "#a855f7", rgb: "168, 85, 247", onAccent: ON_ACCENT_LIGHT },
  { id: "magenta", name: "Magenta", value: "#d946ef", rgb: "217, 70, 239", onAccent: ON_ACCENT_DARK },
  { id: "pink", name: "Pink", value: "#f472b6", rgb: "244, 114, 182", onAccent: ON_ACCENT_DARK },
  { id: "red", name: "Red", value: "#ef4444", rgb: "239, 68, 68", onAccent: ON_ACCENT_LIGHT },
  { id: "amber", name: "Amber", value: "#f59e0b", rgb: "245, 158, 11", onAccent: ON_ACCENT_DARK },
  { id: "lime", name: "Lime", value: "#84cc16", rgb: "132, 204, 22", onAccent: ON_ACCENT_DARK },
  { id: "indigo", name: "Indigo", value: "#6366f1", rgb: "99, 102, 241", onAccent: ON_ACCENT_LIGHT },
  { id: "slate", name: "Slate", value: "#94a3b8", rgb: "148, 163, 184", onAccent: ON_ACCENT_DARK },
];

export function getAccentColor(id: string | null | undefined): AccentColor {
  return ACCENT_COLORS.find((color) => color.id === id) ?? ACCENT_COLORS[0]!;
}

export function isAccentColorId(value: unknown): value is AccentColorId {
  return typeof value === "string" && ACCENT_COLORS.some((color) => color.id === value);
}

// Cache key shared with the pre-hydration script in __root.tsx so the next
// launch can paint the user's accent before React mounts (no orange flash).
export const ACCENT_CACHE_KEY = "mc:accent";

export function applyAccentColor(id: string | null | undefined) {
  if (typeof document === "undefined") return;
  const color = getAccentColor(id);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(accentCssVars(color.id))) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty(
    "--mc-btn-filled-image",
    `url("/borders/button_filled_${color.id}.png")`,
  );
  root.style.setProperty(
    "--mc-panel-focused-image",
    `url("/borders/panel_focused_${color.id}.png")`,
  );
  root.style.setProperty(
    "--mc-panel-image",
    `url("/borders/square_${color.id}.png")`,
  );
  root.style.setProperty(
    "--mc-shell-image",
    `url("/borders/shell_${color.id}.png")`,
  );
  try {
    window.localStorage.setItem(ACCENT_CACHE_KEY, color.id);
  } catch {
    /* localStorage unavailable */
  }
}

/** CSS custom properties that theme pet strokes/fills (and any accent-tinted
 *  subtree). Safe to set on a wrapper so one remote pet can use its owner's
 *  accent without mutating the document root. */
export function accentCssVars(id: string | null | undefined): Record<string, string> {
  const color = getAccentColor(id);
  return {
    "--accent": color.value,
    "--mc-on-accent": color.onAccent,
    "--accent-dim": `rgba(${color.rgb}, 0.18)`,
    "--accent-faint": `rgba(${color.rgb}, 0.1)`,
    "--accent-border": `rgba(${color.rgb}, 0.38)`,
    "--accent-glow": `rgba(${color.rgb}, 0.48)`,
  };
}
