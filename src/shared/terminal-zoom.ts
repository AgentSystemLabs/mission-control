import { TERMINAL_FONT_SIZE } from "~/lib/terminal-options";

export const TERMINAL_ZOOM_LEVELS = [-2, -1, 0, 1, 2] as const;
export type TerminalZoomLevel = (typeof TERMINAL_ZOOM_LEVELS)[number];

export const DEFAULT_TERMINAL_ZOOM_LEVEL: TerminalZoomLevel = 0;
export const TERMINAL_ZOOM_MIN = TERMINAL_ZOOM_LEVELS[0];
export const TERMINAL_ZOOM_MAX = TERMINAL_ZOOM_LEVELS[TERMINAL_ZOOM_LEVELS.length - 1];
export const TERMINAL_ZOOM_STEP_PX = 2;

export const TERMINAL_ZOOM_LABELS: Record<TerminalZoomLevel, string> = {
  [-2]: "Smallest (-2)",
  [-1]: "Smaller (-1)",
  0: "Default",
  1: "Larger (+1)",
  2: "Largest (+2)",
};

export function normalizeTerminalZoomLevel(value: unknown): TerminalZoomLevel | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < TERMINAL_ZOOM_MIN || rounded > TERMINAL_ZOOM_MAX) return null;
  return rounded as TerminalZoomLevel;
}

export function terminalFontSizeForLevel(level: TerminalZoomLevel): number {
  return TERMINAL_FONT_SIZE + level * TERMINAL_ZOOM_STEP_PX;
}

export function clampTerminalZoomLevel(level: number): TerminalZoomLevel {
  return Math.max(
    TERMINAL_ZOOM_MIN,
    Math.min(TERMINAL_ZOOM_MAX, Math.round(level)),
  ) as TerminalZoomLevel;
}

export function stepTerminalZoomLevel(
  level: TerminalZoomLevel,
  delta: 1 | -1,
): TerminalZoomLevel | null {
  const next = level + delta;
  if (next < TERMINAL_ZOOM_MIN || next > TERMINAL_ZOOM_MAX) return null;
  return next as TerminalZoomLevel;
}
