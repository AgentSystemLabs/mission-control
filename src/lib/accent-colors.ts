export type AccentColorId =
  | "deep-orange"
  | "blue"
  | "green"
  | "teal"
  | "cyan"
  | "purple"
  | "magenta"
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
};

export const DEFAULT_ACCENT_COLOR: AccentColorId = "deep-orange";

export const ACCENT_COLORS: AccentColor[] = [
  { id: "deep-orange", name: "Deep orange", value: "#ff5a1f", rgb: "255, 90, 31" },
  { id: "blue", name: "Blue", value: "#3b82f6", rgb: "59, 130, 246" },
  { id: "green", name: "Green", value: "#22c55e", rgb: "34, 197, 94" },
  { id: "teal", name: "Teal", value: "#14b8a6", rgb: "20, 184, 166" },
  { id: "cyan", name: "Cyan", value: "#06b6d4", rgb: "6, 182, 212" },
  { id: "purple", name: "Purple", value: "#a855f7", rgb: "168, 85, 247" },
  { id: "magenta", name: "Magenta", value: "#d946ef", rgb: "217, 70, 239" },
  { id: "red", name: "Red", value: "#ef4444", rgb: "239, 68, 68" },
  { id: "amber", name: "Amber", value: "#f59e0b", rgb: "245, 158, 11" },
  { id: "lime", name: "Lime", value: "#84cc16", rgb: "132, 204, 22" },
  { id: "indigo", name: "Indigo", value: "#6366f1", rgb: "99, 102, 241" },
  { id: "slate", name: "Slate", value: "#94a3b8", rgb: "148, 163, 184" },
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
  root.style.setProperty("--accent", color.value);
  root.style.setProperty("--accent-dim", `rgba(${color.rgb}, 0.18)`);
  root.style.setProperty("--accent-faint", `rgba(${color.rgb}, 0.1)`);
  root.style.setProperty("--accent-border", `rgba(${color.rgb}, 0.38)`);
  root.style.setProperty("--accent-glow", `rgba(${color.rgb}, 0.48)`);
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
