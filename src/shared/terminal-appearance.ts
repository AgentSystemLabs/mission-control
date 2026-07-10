// Terminal + interface appearance settings — font face, weights, line height,
// letter spacing for xterm panes, plus the interface (UI) font face and scale.
// Shared by the settings controller (persistence + validation) and the
// renderer (xterm options + DOM application), so the ranges live here rather
// than in src/lib.

/** CSS font weights offered for terminal text (regular and bold runs). */
export const TERMINAL_FONT_WEIGHTS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
] as const;

export type TerminalFontWeight = (typeof TERMINAL_FONT_WEIGHTS)[number];

export const DEFAULT_TERMINAL_FONT_WEIGHT: TerminalFontWeight = 400;
export const DEFAULT_TERMINAL_FONT_WEIGHT_BOLD: TerminalFontWeight = 700;

export function isTerminalFontWeight(value: unknown): value is TerminalFontWeight {
  return (
    typeof value === "number" &&
    (TERMINAL_FONT_WEIGHTS as readonly number[]).includes(value)
  );
}

/**
 * Line height multipliers for terminal rows. 1.0 is xterm's default and the
 * only value where multi-row ANSI art (box drawing, background fills, startup
 * wordmarks) renders flush — higher values trade that for readability, which
 * is why this is a user choice rather than a theme default.
 */
export const TERMINAL_LINE_HEIGHTS = [
  1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8,
] as const;

export type TerminalLineHeight = (typeof TERMINAL_LINE_HEIGHTS)[number];

export const DEFAULT_TERMINAL_LINE_HEIGHT: TerminalLineHeight = 1.0;

/** Extra horizontal pixels added between terminal cells (xterm letterSpacing). */
export const TERMINAL_LETTER_SPACINGS = [0, 0.5, 1, 1.5, 2, 2.5, 3] as const;

export type TerminalLetterSpacing = (typeof TERMINAL_LETTER_SPACINGS)[number];

export const DEFAULT_TERMINAL_LETTER_SPACING: TerminalLetterSpacing = 0;

/** `null` = the active theme's bundled face (Geist Mono; JetBrains Mono on flat). */
export const DEFAULT_TERMINAL_FONT_FAMILY: string | null = null;

/** Longest font family name accepted from the client. */
export const FONT_FAMILY_MAX_LENGTH = 120;

/**
 * Interface (UI) scale multipliers, applied as the window zoom factor.
 * 1 = 100%; the range mirrors browser zoom's useful span for a dense UI.
 */
export const INTERFACE_FONT_SCALES = [
  0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3,
] as const;

export type InterfaceFontScale = (typeof INTERFACE_FONT_SCALES)[number];

export const DEFAULT_INTERFACE_FONT_SCALE: InterfaceFontScale = 1;

/** `null` = the active theme's UI face (Space Grotesk; Plus Jakarta Sans on flat). */
export const DEFAULT_INTERFACE_FONT_FAMILY: string | null = null;

function nearest<T extends number>(values: readonly T[], value: number): T {
  let best = values[0]!;
  for (const candidate of values) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return best;
}

export function normalizeTerminalFontWeight(
  value: unknown,
  fallback: TerminalFontWeight,
): TerminalFontWeight {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  return nearest(TERMINAL_FONT_WEIGHTS, parsed);
}

export function normalizeTerminalLineHeight(value: unknown): TerminalLineHeight {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_LINE_HEIGHT;
  }
  return nearest(TERMINAL_LINE_HEIGHTS, parsed);
}

export function normalizeTerminalLetterSpacing(value: unknown): TerminalLetterSpacing {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_LETTER_SPACING;
  }
  return nearest(TERMINAL_LETTER_SPACINGS, parsed);
}

export function normalizeInterfaceFontScale(value: unknown): InterfaceFontScale {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_INTERFACE_FONT_SCALE;
  }
  return nearest(INTERFACE_FONT_SCALES, parsed);
}

/** Trim + cap a stored/user font family; empty collapses to null (theme default). */
export function normalizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, FONT_FAMILY_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
