import { describe, expect, it, vi } from "vitest";
import {
  applyTerminalFontSize,
  createTerminalOptions,
  createTerminalTheme,
  getTerminalColorScheme,
  terminalNeedsTransparency,
} from "../terminal-options";

describe("terminal options", () => {
  it("defaults to the dark terminal theme", () => {
    expect(createTerminalOptions()).toMatchObject({
      lineHeight: 1,
      fontSize: 12,
      // Opaque canvas outside flat dark: allowTransparency degrades glyph
      // antialiasing, so it stays off unless the clear color carries alpha.
      allowTransparency: false,
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

  it("swaps in the warm high-contrast ANSI ramp when the flat theme is active (dark)", () => {
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "data-minimal" ? "true" : null),
      },
    });
    try {
      const theme = createTerminalTheme();
      // brightBlack is what CLIs use for dim/secondary text — the stock
      // #22262c is the same tone as the flat theme's #2b2a27 ground (≈1.1:1).
      // Flat clears the canvas to transparent (glass panes) — the ground is
      // painted once by the pane body CSS instead.
      expect(theme).toMatchObject({
        background: "#2b2a2700",
        foreground: "#e9e3d5",
        brightBlack: "#8f8577",
      });
      // The accent selection wash carries more alpha on the mid-gray ground.
      expect(theme.selectionBackground).toBe("#ff5a1f4d");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("zeroes the alpha of a color(srgb ...) terminal ground in flat", () => {
    // Chromium serializes computed colors built from color-mix()/oklch() as
    // "color(srgb r g b)" — the format that silently defeated the alpha edit
    // and shipped the flat theme's "transparent" canvas fully opaque.
    const probe = { style: {} as Record<string, string> };
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "data-minimal" ? "true" : null),
      },
      body: { appendChild: () => undefined, removeChild: () => undefined },
      // No 2d context: forces the raw color(srgb) string through withAlpha.
      createElement: (tag: string) =>
        tag === "canvas" ? { getContext: () => null } : probe,
    });
    vi.stubGlobal("getComputedStyle", (el: unknown) =>
      el === probe
        ? { color: "color(srgb 0.183451 0.200157 0.227451)" }
        : { getPropertyValue: () => "color(srgb 0.183451 0.200157 0.227451)" }
    );
    try {
      expect(createTerminalTheme().background).toBe("rgba(47, 51, 58, 0)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the stock light ramp for the flat theme in light mode", () => {
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "data-minimal" ? "true" : null),
      },
    });
    try {
      // Light overrides the warm dark ramp — flatDark requires colorScheme dark.
      expect(createTerminalTheme({ colorScheme: "light" }).brightBlack).not.toBe(
        "#8f8577",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enables canvas transparency only for the flat dark glass theme", () => {
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "data-minimal" ? "true" : null),
      },
    });
    try {
      // Flat dark: the canvas clear color is transparent, so xterm must
      // honor its alpha.
      expect(createTerminalOptions({ colorScheme: "dark" }).allowTransparency).toBe(true);
      // Flat LIGHT keeps an opaque canvas — transparency switches the glyph
      // atlas to a transparent backing and dark ink on light paper renders
      // visibly thin/washed out.
      expect(createTerminalOptions({ colorScheme: "light" }).allowTransparency).toBe(false);
      expect(terminalNeedsTransparency("dark")).toBe(true);
      expect(terminalNeedsTransparency("light")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the stock dark ramp when the flat theme is not active", () => {
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
