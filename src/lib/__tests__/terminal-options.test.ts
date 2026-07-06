import { describe, expect, it, vi } from "vitest";
import {
  applyTerminalFontSize,
  createTerminalOptions,
  createTerminalTheme,
  getTerminalColorScheme,
} from "../terminal-options";

describe("terminal options", () => {
  it("defaults to the dark terminal theme", () => {
    expect(createTerminalOptions()).toMatchObject({
      lineHeight: 1,
      fontSize: 12,
    });
    expect(createTerminalOptions().theme).toMatchObject({
      background: "#050607",
      foreground: "#e8e6df",
      cursor: "#ff5a1f",
    });
  });

  it("uses a readable light terminal theme", () => {
    expect(createTerminalTheme({ colorScheme: "light" })).toMatchObject({
      background: "#ffffff",
      foreground: "#1a1a1a",
      black: "#1a1a1a",
      white: "#f1f0eb",
    });
  });

  it("keeps agent-specific cursor colors across themes", () => {
    expect(createTerminalTheme({ colorScheme: "light", cursorColor: "#2e90fa" }).cursor).toBe(
      "#2e90fa"
    );
  });

  it("falls back to dark outside the browser", () => {
    expect(getTerminalColorScheme()).toBe("dark");
  });

  it("swaps in the warm high-contrast ANSI ramp when ember is active", () => {
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "data-ember" ? "true" : null),
      },
    });
    try {
      const theme = createTerminalTheme();
      // brightBlack is what CLIs use for dim/secondary text — the stock
      // #22262c is the same tone as ember's #2b2a27 ground (≈1.1:1).
      expect(theme).toMatchObject({
        background: "#2b2a27",
        foreground: "#e9e3d5",
        brightBlack: "#8f8577",
      });
      // The accent selection wash carries more alpha on the mid-gray ground.
      expect(theme.selectionBackground).toBe("#ff5a1f4d");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the stock dark ramp when ember is not active", () => {
    expect(createTerminalTheme().brightBlack).toBe("#22262c");
  });

  it("preserves the viewport line when zoom refits a scrolled terminal", () => {
    const term = {
      options: { fontSize: 12 },
      cols: 100,
      rows: 30,
      buffer: { active: { viewportY: 42, baseY: 120 } },
      refresh: vi.fn(),
      scrollToLine: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const fit = {
      fit: vi.fn(() => {
        term.buffer.active.viewportY = 0;
      }),
    };

    applyTerminalFontSize(term, fit, 14);

    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.scrollToLine).toHaveBeenCalledWith(42);
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it("keeps the terminal pinned to bottom when zoom refits at the live prompt", () => {
    const term = {
      options: { fontSize: 12 },
      cols: 100,
      rows: 30,
      buffer: { active: { viewportY: 120, baseY: 120 } },
      refresh: vi.fn(),
      scrollToLine: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const fit = {
      fit: vi.fn(() => {
        term.buffer.active.viewportY = 0;
      }),
    };

    applyTerminalFontSize(term, fit, 14);

    expect(term.scrollToBottom).toHaveBeenCalledOnce();
    expect(term.scrollToLine).not.toHaveBeenCalled();
  });
});
