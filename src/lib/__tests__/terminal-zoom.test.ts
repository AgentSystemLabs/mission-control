import { describe, expect, it } from "vitest";
import {
  clampTerminalZoomLevel,
  normalizeTerminalZoomLevel,
  stepTerminalZoomLevel,
  terminalFontSizeForLevel,
} from "~/shared/terminal-zoom";
import {
  resolveTerminalZoomLevel,
} from "~/lib/terminal-zoom-storage";

describe("terminal zoom helpers", () => {
  it("maps zoom levels to font sizes in 2px steps", () => {
    expect(terminalFontSizeForLevel(-2)).toBe(8);
    expect(terminalFontSizeForLevel(0)).toBe(12);
    expect(terminalFontSizeForLevel(2)).toBe(16);
  });

  it("normalizes and clamps zoom levels", () => {
    expect(normalizeTerminalZoomLevel("1")).toBe(1);
    expect(normalizeTerminalZoomLevel(99)).toBeNull();
    expect(clampTerminalZoomLevel(-9)).toBe(-2);
    expect(clampTerminalZoomLevel(9)).toBe(2);
  });

  it("steps within bounds", () => {
    expect(stepTerminalZoomLevel(0, 1)).toBe(1);
    expect(stepTerminalZoomLevel(2, 1)).toBeNull();
    expect(stepTerminalZoomLevel(-2, -1)).toBeNull();
  });
});

describe("terminal zoom storage", () => {
  it("falls back to the global level when no override exists", () => {
    expect(resolveTerminalZoomLevel("missing-instance", -1)).toBe(-1);
  });
});
