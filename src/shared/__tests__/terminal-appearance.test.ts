import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERFACE_FONT_SCALE,
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_LETTER_SPACING,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  FONT_FAMILY_MAX_LENGTH,
  isTerminalFontWeight,
  normalizeFontFamily,
  normalizeInterfaceFontScale,
  normalizeTerminalFontWeight,
  normalizeTerminalLetterSpacing,
  normalizeTerminalLineHeight,
} from "~/shared/terminal-appearance";

describe("terminal appearance normalizers", () => {
  it("accepts every hundred weight and rejects the rest", () => {
    expect(isTerminalFontWeight(400)).toBe(true);
    expect(isTerminalFontWeight(900)).toBe(true);
    expect(isTerminalFontWeight(450)).toBe(false);
    expect(isTerminalFontWeight("400")).toBe(false);
  });

  it("normalizes weights from stored strings and snaps to the nearest step", () => {
    expect(normalizeTerminalFontWeight("300", DEFAULT_TERMINAL_FONT_WEIGHT)).toBe(300);
    expect(normalizeTerminalFontWeight(449, DEFAULT_TERMINAL_FONT_WEIGHT)).toBe(400);
    expect(normalizeTerminalFontWeight(451, DEFAULT_TERMINAL_FONT_WEIGHT)).toBe(500);
    expect(normalizeTerminalFontWeight("junk", 700)).toBe(700);
    expect(normalizeTerminalFontWeight(null, 700)).toBe(700);
  });

  it("normalizes line height within 1.0–1.8", () => {
    expect(normalizeTerminalLineHeight("1.2")).toBe(1.2);
    expect(normalizeTerminalLineHeight(99)).toBe(1.8);
    expect(normalizeTerminalLineHeight(-1)).toBe(1.0);
    expect(normalizeTerminalLineHeight(undefined)).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
  });

  it("normalizes letter spacing to half-pixel steps", () => {
    expect(normalizeTerminalLetterSpacing("0.5")).toBe(0.5);
    expect(normalizeTerminalLetterSpacing(0.6)).toBe(0.5);
    expect(normalizeTerminalLetterSpacing(100)).toBe(3);
    expect(normalizeTerminalLetterSpacing("junk")).toBe(
      DEFAULT_TERMINAL_LETTER_SPACING,
    );
  });

  it("normalizes interface scale to the offered steps", () => {
    expect(normalizeInterfaceFontScale("1.1")).toBe(1.1);
    expect(normalizeInterfaceFontScale(3)).toBe(1.3);
    expect(normalizeInterfaceFontScale(0)).toBe(0.85);
    expect(normalizeInterfaceFontScale(null)).toBe(DEFAULT_INTERFACE_FONT_SCALE);
  });

  it("trims, caps, and nulls empty font families", () => {
    expect(normalizeFontFamily("  Fira Code  ")).toBe("Fira Code");
    expect(normalizeFontFamily("")).toBeNull();
    expect(normalizeFontFamily("   ")).toBeNull();
    expect(normalizeFontFamily(42)).toBeNull();
    expect(normalizeFontFamily("x".repeat(500))).toHaveLength(FONT_FAMILY_MAX_LENGTH);
  });
});
