import { afterEach, describe, expect, it } from "vitest";
import {
  clampTerminalZoomLevel,
  normalizeTerminalZoomLevel,
  stepTerminalZoomLevel,
  terminalFontSizeForLevel,
} from "~/shared/terminal-zoom";
import {
  clearTerminalInstanceZoom,
  readTerminalInstanceZoom,
  resolveTerminalZoomLevel,
  writeTerminalInstanceZoom,
} from "~/lib/terminal-zoom-storage";

/** Back the node env with a Map-backed localStorage so storage round-trips run. */
function stubLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

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
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("falls back to the global level when no override exists", () => {
    expect(resolveTerminalZoomLevel("missing-instance", -1)).toBe(-1);
  });

  it("writes, reads back, and clears a per-instance override", () => {
    stubLocalStorage();
    writeTerminalInstanceZoom("t1", 2);
    expect(readTerminalInstanceZoom("t1")).toBe(2);
    // Override wins over the global level.
    expect(resolveTerminalZoomLevel("t1", -1)).toBe(2);

    clearTerminalInstanceZoom("t1");
    expect(readTerminalInstanceZoom("t1")).toBeNull();
    // With the override gone, resolution falls back to the global level.
    expect(resolveTerminalZoomLevel("t1", -1)).toBe(-1);
  });
});
