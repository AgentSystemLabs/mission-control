// Detects which of a curated list of font families are installed, by
// measuring text width against the generic fallback families on a canvas —
// a candidate that renders differently from every generic fallback is real.
// (queryLocalFonts needs a permission prompt; this is silent and instant.)
import { useEffect, useState } from "react";

/** Faces shipped with the app via @fontsource — always available. */
export const BUNDLED_TERMINAL_FONTS = ["Geist Mono", "JetBrains Mono"] as const;

/** Common monospace faces worth probing for on a dev machine. */
export const SYSTEM_MONO_FONT_CANDIDATES = [
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
  "Andale Mono",
  "PT Mono",
  "Fira Code",
  "Fira Mono",
  "Hack",
  "Source Code Pro",
  "Cascadia Code",
  "Cascadia Mono",
  "IBM Plex Mono",
  "Roboto Mono",
  "Ubuntu Mono",
  "Inconsolata",
  "Victor Mono",
  "Iosevka",
  "Berkeley Mono",
  "Commit Mono",
  "Monaspace Neon",
  "Space Mono",
  "Anonymous Pro",
  "DejaVu Sans Mono",
  "Droid Sans Mono",
  "Input Mono",
  "Operator Mono",
  "Red Hat Mono",
  "MonoLisa",
  "Comic Mono",
] as const;

/** Common UI faces worth probing for the interface font picker. */
export const INTERFACE_FONT_CANDIDATES = [
  "SF Pro",
  "SF Pro Text",
  "Helvetica Neue",
  "Inter",
  "Roboto",
  "Segoe UI",
  "Arial",
  "Avenir Next",
  "Futura",
  "Gill Sans",
  "Verdana",
  "Lato",
  "Open Sans",
  "Source Sans Pro",
  "IBM Plex Sans",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "Manrope",
  "Georgia",
  "Iowan Old Style",
  "Palatino",
  "Optima",
] as const;

// Wide glyph mix: repeated wides for signal, plus narrow/odd glyphs so two
// different faces are unlikely to produce identical widths by coincidence.
const SAMPLE = "mmmmmmmmmmlli1I0O@#WwQq";
const GENERIC_FALLBACKS = ["monospace", "serif", "sans-serif"] as const;

/**
 * Measure `SAMPLE` in `family, generic` against `generic` alone for each
 * generic fallback. If any pair differs, the browser found a real face for
 * `family` (identical metrics across ALL generics means it fell back).
 */
export function detectAvailableFonts(candidates: readonly string[]): string[] {
  if (typeof document === "undefined") return [];
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  const baseline = new Map<string, number>();
  for (const generic of GENERIC_FALLBACKS) {
    ctx.font = `16px ${generic}`;
    baseline.set(generic, ctx.measureText(SAMPLE).width);
  }
  return candidates.filter((family) => {
    const quoted = `"${family.replace(/"/g, "")}"`;
    return GENERIC_FALLBACKS.some((generic) => {
      ctx.font = `16px ${quoted}, ${generic}`;
      return ctx.measureText(SAMPLE).width !== baseline.get(generic);
    });
  });
}

/**
 * Detected system fonts from `candidates`, refreshed once webfonts settle
 * (document.fonts.ready) so late-loading faces don't skew the measurement.
 */
export function useDetectedFonts(candidates: readonly string[]): string[] {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) setFonts(detectAvailableFonts(candidates));
    };
    run();
    document.fonts?.ready?.then(run).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // candidates lists are module constants; identity is stable per call site.
  }, [candidates]);
  return fonts;
}
