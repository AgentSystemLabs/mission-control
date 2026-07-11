// Applies the terminal appearance settings (font face/weights/line height/
// letter spacing) to the DOM as inline CSS vars on <html>. Terminals don't
// read the settings query directly: createTerminalOptions resolves these vars
// when a terminal is built, and watchTerminalColorScheme (which already
// observes <html> style mutations) re-fires for live terminals, so an inline
// var write here restyles every open pane. The font var override also feeds
// the settings-page preview and any CSS that renders "terminal-looking" text.
import {
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  DEFAULT_TERMINAL_LETTER_SPACING,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  normalizeTerminalFontWeight,
  normalizeTerminalLetterSpacing,
  normalizeTerminalLineHeight,
  type TerminalFontWeight,
  type TerminalLetterSpacing,
  type TerminalLineHeight,
} from "~/shared/terminal-appearance";

export const TERMINAL_FONT_VAR = "--mc-terminal-font";
export const TERMINAL_FONT_WEIGHT_VAR = "--mc-terminal-font-weight";
export const TERMINAL_FONT_WEIGHT_BOLD_VAR = "--mc-terminal-font-weight-bold";
export const TERMINAL_LINE_HEIGHT_VAR = "--mc-terminal-line-height";
export const TERMINAL_LETTER_SPACING_VAR = "--mc-terminal-letter-spacing";

export type TerminalAppearance = {
  /** `null` = the active theme's bundled face. */
  fontFamily: string | null;
  fontWeight: TerminalFontWeight;
  fontWeightBold: TerminalFontWeight;
  lineHeight: TerminalLineHeight;
  letterSpacing: TerminalLetterSpacing;
};

/** Wrap a user-picked family in quotes and append the mono fallback stack. */
export function terminalFontStack(family: string): string {
  return `"${family.replace(/"/g, "")}", ui-monospace, "SF Mono", Menlo, monospace`;
}

/**
 * Write the appearance to inline CSS vars on <html>. An inline
 * `--mc-terminal-font` outranks every theme stylesheet block, so clearing it
 * (family = null) hands control back to the active theme's bundled face.
 */
export function applyTerminalAppearance(appearance: TerminalAppearance): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement?.style;
  if (!style) return;
  if (appearance.fontFamily) {
    style.setProperty(TERMINAL_FONT_VAR, terminalFontStack(appearance.fontFamily));
  } else {
    style.removeProperty(TERMINAL_FONT_VAR);
  }
  const setOrClear = (name: string, value: number, fallback: number) => {
    if (value === fallback) style.removeProperty(name);
    else style.setProperty(name, String(value));
  };
  setOrClear(
    TERMINAL_FONT_WEIGHT_VAR,
    appearance.fontWeight,
    DEFAULT_TERMINAL_FONT_WEIGHT,
  );
  setOrClear(
    TERMINAL_FONT_WEIGHT_BOLD_VAR,
    appearance.fontWeightBold,
    DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  );
  setOrClear(
    TERMINAL_LINE_HEIGHT_VAR,
    appearance.lineHeight,
    DEFAULT_TERMINAL_LINE_HEIGHT,
  );
  setOrClear(
    TERMINAL_LETTER_SPACING_VAR,
    appearance.letterSpacing,
    DEFAULT_TERMINAL_LETTER_SPACING,
  );
}

function readVar(name: string): string {
  // Optional chaining throughout: tests stub a partial `document`.
  if (typeof document === "undefined") return "";
  return document.documentElement?.style?.getPropertyValue?.(name)?.trim() ?? "";
}

/** The currently applied weights/spacing, read back from the inline vars. */
export function getCurrentTerminalAppearanceOptions(): {
  fontWeight: TerminalFontWeight;
  fontWeightBold: TerminalFontWeight;
  lineHeight: TerminalLineHeight;
  letterSpacing: TerminalLetterSpacing;
} {
  const weightRaw = readVar(TERMINAL_FONT_WEIGHT_VAR);
  const boldRaw = readVar(TERMINAL_FONT_WEIGHT_BOLD_VAR);
  const lineHeightRaw = readVar(TERMINAL_LINE_HEIGHT_VAR);
  const letterSpacingRaw = readVar(TERMINAL_LETTER_SPACING_VAR);
  return {
    fontWeight: weightRaw
      ? normalizeTerminalFontWeight(weightRaw, DEFAULT_TERMINAL_FONT_WEIGHT)
      : DEFAULT_TERMINAL_FONT_WEIGHT,
    fontWeightBold: boldRaw
      ? normalizeTerminalFontWeight(boldRaw, DEFAULT_TERMINAL_FONT_WEIGHT_BOLD)
      : DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
    lineHeight: lineHeightRaw
      ? normalizeTerminalLineHeight(lineHeightRaw)
      : DEFAULT_TERMINAL_LINE_HEIGHT,
    letterSpacing: letterSpacingRaw
      ? normalizeTerminalLetterSpacing(letterSpacingRaw)
      : DEFAULT_TERMINAL_LETTER_SPACING,
  };
}

/** Cache-key fragment so terminal watchers re-fire when appearance vars change. */
export function terminalAppearanceKey(): string {
  const current = getCurrentTerminalAppearanceOptions();
  return `${current.fontWeight}:${current.fontWeightBold}:${current.lineHeight}:${current.letterSpacing}`;
}
