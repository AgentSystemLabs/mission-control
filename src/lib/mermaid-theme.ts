export type MissionControlColorScheme = "dark" | "light";

export type MermaidInitConfig = {
  startOnLoad: false;
  theme: "base";
  securityLevel: "strict";
  fontFamily: string;
  themeVariables: Record<string, string | boolean>;
};

export function getMissionControlColorScheme(): MissionControlColorScheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/**
 * Build a reader that resolves theme CSS variables into colors mermaid can
 * parse. Custom properties keep their authored text — the minimal theme's
 * surfaces are `oklch(…)` — but mermaid's color parser (khroma) only
 * understands hex/rgb/hsl, so raw values crash `mermaid.render` with
 * "Unsupported color format". A canvas fillStyle round-trip has the browser
 * serialize any color it can parse to hex/rgba; values it can't parse fall
 * back to the hardcoded default rather than failing the render.
 */
function createCssColorReader(): (name: string, fallback: string) => string {
  if (typeof window === "undefined") return (_name, fallback) => fallback;
  const rootStyle = getComputedStyle(document.documentElement);
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return (name, fallback) => {
    const raw = rootStyle.getPropertyValue(name).trim();
    if (!raw) return fallback;
    if (!ctx) return raw;
    // fillStyle silently keeps its previous value when assigned something
    // unparseable, so round-trip against two sentinels to tell "parsed to
    // black" apart from "not a color".
    ctx.fillStyle = "#000000";
    ctx.fillStyle = raw;
    const serialized = ctx.fillStyle;
    if (serialized === "#000000") {
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = raw;
      if (ctx.fillStyle === "#ffffff") return fallback;
    }
    // Canvas serializes to #rrggbb / rgba(); anything else (a future engine
    // emitting color(srgb …)) would still crash khroma, so fall back.
    return typeof serialized === "string" && /^(#|rgba?\()/.test(serialized)
      ? serialized
      : fallback;
  };
}

export function buildMermaidInitConfig(
  scheme: MissionControlColorScheme = getMissionControlColorScheme(),
): MermaidInitConfig {
  const isDark = scheme === "dark";
  const readCssVar = createCssColorReader();

  const accent = readCssVar("--accent", "#ff5a1f");
  const text = readCssVar("--text", isDark ? "#e8e6df" : "#1a1a1a");
  const textDim = readCssVar(
    "--text-dim",
    isDark ? "rgba(232, 230, 223, 0.6)" : "rgba(26, 26, 26, 0.62)",
  );
  const textFaint = readCssVar(
    "--text-faint",
    isDark ? "rgba(232, 230, 223, 0.38)" : "rgba(26, 26, 26, 0.38)",
  );
  const surface1 = readCssVar("--surface-1", isDark ? "#14171b" : "#fafaf7");
  const surface2 = readCssVar("--surface-2", isDark ? "#1a1d22" : "#f1f0eb");
  const surface3 = readCssVar("--surface-3", isDark ? "#22262c" : "#e7e6e0");
  const accentBorder = readCssVar("--accent-border", "rgba(255, 90, 31, 0.38)");

  return {
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    fontFamily: "var(--mono, ui-monospace, monospace)",
    themeVariables: {
      darkMode: isDark,
      background: "transparent",
      primaryColor: accent,
      primaryTextColor: text,
      primaryBorderColor: accentBorder,
      secondaryColor: surface1,
      tertiaryColor: surface2,
      mainBkg: surface2,
      nodeBorder: textFaint,
      lineColor: textDim,
      textColor: text,
      titleColor: text,
      edgeLabelBackground: surface1,
      clusterBkg: surface1,
      actorBkg: surface2,
      actorBorder: textFaint,
      actorTextColor: text,
      actorLineColor: textDim,
      signalColor: textDim,
      signalTextColor: text,
      labelBoxBkgColor: surface1,
      labelBoxBorderColor: textFaint,
      labelTextColor: text,
      loopTextColor: text,
      noteBkgColor: surface1,
      noteBorderColor: textFaint,
      noteTextColor: text,
      activationBkgColor: surface3,
      activationBorderColor: textFaint,
      sequenceNumberColor: textDim,
    },
  };
}

export function watchMissionControlColorScheme(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });
  return () => observer.disconnect();
}
