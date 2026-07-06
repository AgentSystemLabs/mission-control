import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMermaidInitConfig } from "../mermaid-theme";

/**
 * Mimics Chromium's canvas fillStyle behavior: parseable colors are
 * serialized (per `serialize`), unparseable assignments are silently
 * ignored and fillStyle keeps its previous value.
 */
function createFakeCanvasContext(serialize: (value: string) => string | null) {
  let current = "#000000";
  return {
    get fillStyle() {
      return current;
    },
    set fillStyle(value: string) {
      const next = serialize(value);
      if (next !== null) current = next;
    },
  };
}

function stubBrowserGlobals({
  cssVars,
  canvasContext,
}: {
  cssVars: Record<string, string>;
  canvasContext: unknown;
}) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {
    documentElement: {},
    createElement: () => ({ getContext: () => canvasContext }),
  });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => cssVars[name] ?? "",
  }));
}

const HEX_SENTINELS = new Set(["#000000", "#ffffff"]);

describe("buildMermaidInitConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the base theme with darkMode for dark scheme", () => {
    const config = buildMermaidInitConfig("dark");
    expect(config.theme).toBe("base");
    expect(config.themeVariables.darkMode).toBe(true);
    expect(config.themeVariables.background).toBe("transparent");
    expect(config.themeVariables.actorBkg).toBe("#1a1d22");
    expect(config.themeVariables.lineColor).toBe("rgba(232, 230, 223, 0.6)");
  });

  it("uses light palette values for light scheme", () => {
    const config = buildMermaidInitConfig("light");
    expect(config.themeVariables.darkMode).toBe(false);
    expect(config.themeVariables.actorBkg).toBe("#f1f0eb");
    expect(config.themeVariables.primaryTextColor).toBe("#1a1a1a");
  });

  it("includes sequence diagram variables for contrast", () => {
    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.actorBorder).toBeTruthy();
    expect(config.themeVariables.signalColor).toBeTruthy();
    expect(config.themeVariables.activationBkgColor).toBeTruthy();
  });

  it("serializes oklch theme colors to canvas-normalized values before handing them to mermaid", () => {
    // Regression: the minimal theme's oklch() surfaces reached mermaid raw
    // and its color parser (khroma) threw "Unsupported color format".
    stubBrowserGlobals({
      cssVars: {
        "--surface-1": "oklch(0.145 0.005 245)",
        "--border": "oklch(0.62 0.010 245 / 0.16)",
      },
      canvasContext: createFakeCanvasContext((value) => {
        if (HEX_SENTINELS.has(value)) return value;
        if (value === "oklch(0.145 0.005 245)") return "#222528";
        if (value === "oklch(0.62 0.010 245 / 0.16)") return "rgba(151, 156, 163, 0.16)";
        return null;
      }),
    });

    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.secondaryColor).toBe("#222528");
    expect(config.themeVariables.edgeLabelBackground).toBe("#222528");
    expect(JSON.stringify(config.themeVariables)).not.toContain("oklch");
  });

  it("falls back to the default palette when a theme color can't be parsed", () => {
    stubBrowserGlobals({
      cssVars: { "--surface-1": "color-mix(in exotic, red, blue)" },
      canvasContext: createFakeCanvasContext((value) =>
        HEX_SENTINELS.has(value) ? value : null,
      ),
    });

    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.secondaryColor).toBe("#14171b");
  });

  it("keeps a theme color that legitimately serializes to the black sentinel", () => {
    stubBrowserGlobals({
      cssVars: { "--surface-1": "rgb(0, 0, 0)" },
      canvasContext: createFakeCanvasContext((value) =>
        HEX_SENTINELS.has(value) ? value : value === "rgb(0, 0, 0)" ? "#000000" : null,
      ),
    });

    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.secondaryColor).toBe("#000000");
  });

  it("falls back when the canvas serializes to a non-hex/rgb form", () => {
    stubBrowserGlobals({
      cssVars: { "--surface-1": "oklch(0.145 0.005 245)" },
      canvasContext: createFakeCanvasContext((value) =>
        HEX_SENTINELS.has(value) ? value : "color(srgb 0.13 0.14 0.16)",
      ),
    });

    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.secondaryColor).toBe("#14171b");
  });

  it("passes raw values through when a canvas context is unavailable", () => {
    stubBrowserGlobals({
      cssVars: { "--surface-1": "#1a1d22" },
      canvasContext: null,
    });

    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.secondaryColor).toBe("#1a1d22");
  });
});
