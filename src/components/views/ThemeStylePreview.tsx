import type { CSSProperties } from "react";
import { getAccentColor, type AccentColorId } from "~/lib/accent-colors";
import type { ThemeStyle } from "~/shared/theme-style";
import type { SurfaceTint } from "~/shared/surface-tint";
import type { Theme } from "~/lib/use-theme";

/**
 * Live-rendered miniature of the app (title bar, session grid with a focused
 * pane, status bar) drawn with a style's real palette plus the currently
 * selected accent and surface tint — so the user sees what each theme style
 * does to the whole UI before committing. Shared by the Theme settings page
 * and the first-launch onboarding overlay.
 *
 * Palette values are copied from the corresponding blocks in src/styles.css
 * (:root for painted, [data-minimal] for flat) — keep them in sync when a
 * palette is retuned. Tint percentages mirror the [data-tint] recipe blocks at
 * the bottom of styles.css. Painted is dark-only; the flat miniature follows
 * the current light/dark appearance ([data-minimal][data-theme="light"]).
 */

type StylePalette = {
  /** Page ground behind the panes. */
  bg: string;
  /** Session pane / card surface. */
  surface0: string;
  /** Header / status-bar surface. */
  surface1: string;
  border: string;
  textDim: string;
  textFaint: string;
  /** Pane corner radius — flat is square, painted rounded. */
  radius: number;
  /** How the focused pane announces itself. */
  focus: "painted" | "solid";
};

const STYLE_PALETTES: Record<ThemeStyle, StylePalette> = {
  painted: {
    bg: "#000000",
    surface0: "#0e1013",
    surface1: "#14171b",
    border: "rgba(255, 255, 255, 0.06)",
    textDim: "rgba(232, 230, 223, 0.6)",
    textFaint: "rgba(232, 230, 223, 0.38)",
    radius: 6,
    focus: "painted",
  },
  flat: {
    bg: "oklch(0.09 0.004 65)",
    surface0: "oklch(0.125 0.005 65)",
    surface1: "oklch(0.155 0.006 65)",
    border: "rgba(236, 224, 202, 0.12)",
    textDim: "#c6bca8",
    textFaint: "#a89e8c",
    radius: 0,
    focus: "solid",
  },
};

// Flat's light appearance — mirrors [data-minimal][data-theme="light"] in
// styles.css so the miniature matches the app when light mode is picked.
// (Painted is dark-only, so it has no light variant.)
const FLAT_LIGHT_PALETTE: StylePalette = {
  bg: "#f4f4f6",
  surface0: "#ffffff",
  surface1: "#fafafb",
  border: "rgba(18, 22, 33, 0.09)",
  textDim: "rgba(23, 24, 28, 0.6)",
  textFaint: "rgba(23, 24, 28, 0.4)",
  radius: 0,
  focus: "solid",
};

// Mirrors the [data-tint] recipes in styles.css: [lo, md] percentages per
// theme × level (hi isn't needed — the mock has no raised chrome).
const TINT_RECIPES: Record<ThemeStyle, Record<SurfaceTint, [number, number]>> = {
  painted: { off: [0, 0], subtle: [2.5, 3.5], vivid: [7, 9], intense: [13, 16] },
  flat: { off: [0, 0], subtle: [2.5, 3.5], vivid: [7, 9], intense: [13, 16] },
};

function mix(accent: string, pct: number, base: string): string {
  if (pct <= 0) return base;
  return `color-mix(in srgb, ${accent} ${pct}%, ${base})`;
}

export function ThemeStylePreview({
  style,
  accentId,
  tint,
  theme = "dark",
}: {
  style: ThemeStyle;
  accentId: AccentColorId;
  tint: SurfaceTint;
  /** Current light/dark appearance. Painted is dark-only; flat follows this. */
  theme?: Theme;
}) {
  const accent = getAccentColor(accentId);
  // Painted is dark-only; flat swaps to its paper palette in light mode.
  const lightFlat = style === "flat" && theme === "light";
  const palette = lightFlat ? FLAT_LIGHT_PALETTE : STYLE_PALETTES[style];
  // Flat + Intense (DARK only) re-binds the ground to the Ember warm-charcoal
  // ladder (see [data-minimal][data-theme="dark"][data-tint="intense"] in
  // styles.css) rather than washing the near-black base — mirror that here so
  // the miniature matches. Flat-light + Intense keeps its paper ground and
  // takes the generic wash below. A whisper of accent, matching the CSS recipe.
  const flatIntense = style === "flat" && tint === "intense" && theme === "dark";
  const base = flatIntense
    ? { bg: "#242321", surface0: "#2c2b28", surface1: "#34322d", lo: 4, md: 5 }
    : {
        bg: palette.bg,
        surface0: palette.surface0,
        surface1: palette.surface1,
        lo: TINT_RECIPES[style][tint][0],
        md: TINT_RECIPES[style][tint][1],
      };
  const bg = mix(accent.value, base.lo, base.bg);
  const surface0 = mix(accent.value, base.md, base.surface0);
  const surface1 = mix(accent.value, base.md, base.surface1);
  const accentRgba = (a: number) => `rgba(${accent.rgb}, ${a})`;

  const focusedPaneStyle: CSSProperties =
    palette.focus === "painted"
      ? {
          border: `2px solid ${accentRgba(0.8)}`,
          boxShadow: `0 0 10px ${accentRgba(0.4)}`,
        }
      : {
          border: `1px solid ${accent.value}`,
          boxShadow: lightFlat
            ? `0 2px 6px rgba(18, 22, 33, 0.14)`
            : `0 3px 8px rgba(0, 0, 0, 0.35)`,
        };

  const pane = (focused: boolean, lines: number[]) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: 5,
        background: surface0,
        border: `1px solid ${palette.border}`,
        borderRadius: palette.radius,
        ...(focused ? focusedPaneStyle : null),
      }}
    >
      {/* Pane header: title stub + status dot (accent on the focused pane). */}
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span
          style={{
            width: "40%",
            height: 3,
            borderRadius: 2,
            background: focused ? palette.textDim : palette.textFaint,
          }}
        />
        <span
          style={{
            marginLeft: "auto",
            width: 4,
            height: 4,
            borderRadius: 999,
            background: focused ? accent.value : palette.textFaint,
          }}
        />
      </div>
      {/* Terminal line stubs; the focused pane shows an accent prompt line. */}
      {lines.map((width, i) => (
        <span
          key={i}
          style={{
            width: `${width}%`,
            height: 2,
            borderRadius: 2,
            background:
              focused && i === lines.length - 1
                ? accentRgba(0.85)
                : palette.textFaint,
          }}
        />
      ))}
    </div>
  );

  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "100%",
        aspectRatio: "16 / 10",
        padding: 6,
        background: bg,
        border: `1px solid ${palette.border}`,
        borderRadius: palette.radius + 2,
        // Painted's shell frame, hinted as an accent-tinted outer edge.
        ...(style === "painted"
          ? { boxShadow: `inset 0 0 0 2px ${accentRgba(0.35)}` }
          : null),
      }}
    >
      {/* Title bar: traffic lights + an accent action chip on the right. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          padding: "3px 5px",
          background: surface1,
          border: `1px solid ${palette.border}`,
          borderRadius: palette.radius,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 4,
              borderRadius: 999,
              background: palette.textFaint,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: "auto",
            width: 18,
            height: 5,
            borderRadius: palette.radius === 0 ? 0 : 2,
            background: accent.value,
          }}
        />
      </div>
      {/* Session grid: 2×2 panes, top-left focused. */}
      <div style={{ flex: 1, display: "flex", gap: 4, minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {pane(true, [70, 55, 62])}
          {pane(false, [58, 44])}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {pane(false, [64, 50])}
          {pane(false, [52, 66])}
        </div>
      </div>
      {/* Status bar. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 5px",
          background: surface1,
          border: `1px solid ${palette.border}`,
          borderRadius: palette.radius,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: accentRgba(0.9),
          }}
        />
        <span
          style={{
            width: "30%",
            height: 2,
            borderRadius: 2,
            background: palette.textFaint,
          }}
        />
        <span
          style={{
            marginLeft: "auto",
            width: "18%",
            height: 2,
            borderRadius: 2,
            background: palette.textFaint,
          }}
        />
      </div>
    </div>
  );
}
