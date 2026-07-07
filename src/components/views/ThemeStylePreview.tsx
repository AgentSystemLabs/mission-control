import type { CSSProperties } from "react";
import { getAccentColor, type AccentColorId } from "~/lib/accent-colors";
import type { ThemeStyle } from "~/shared/theme-style";
import type { SurfaceTint } from "~/shared/surface-tint";

/**
 * Live-rendered miniature of the app (title bar, session grid with a focused
 * pane, status bar) drawn with a style's real palette plus the currently
 * selected accent and surface tint — so the user sees what each theme style
 * does to the whole UI before committing. Shared by the Theme settings page
 * and the first-launch onboarding overlay.
 *
 * Palette values are copied from the corresponding blocks in src/styles.css
 * (:root, [data-minimal], [data-noir], [data-ember]) — keep them in sync when
 * a palette is retuned. Tint percentages mirror the [data-tint] recipe blocks
 * at the bottom of styles.css.
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
  /** Pane corner radius — ember is square, painted the roundest. */
  radius: number;
  /** How the focused pane announces itself. */
  focus: "painted" | "ring" | "hairline" | "solid";
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
  minimal: {
    bg: "oklch(0.08 0.003 245)",
    surface0: "oklch(0.115 0.004 245)",
    surface1: "oklch(0.145 0.005 245)",
    border: "oklch(0.62 0.010 245 / 0.16)",
    textDim: "rgba(232, 230, 223, 0.6)",
    textFaint: "rgba(232, 230, 223, 0.38)",
    radius: 5,
    focus: "ring",
  },
  noir: {
    bg: "#0a0a0c",
    surface0: "#0f0f12",
    surface1: "#131317",
    border: "rgba(255, 255, 255, 0.065)",
    textDim: "rgba(233, 233, 236, 0.56)",
    textFaint: "rgba(233, 233, 236, 0.33)",
    radius: 4,
    focus: "hairline",
  },
  ember: {
    bg: "#242321",
    surface0: "#2c2b28",
    surface1: "#34322d",
    border: "rgba(236, 224, 202, 0.15)",
    textDim: "#c6bca8",
    textFaint: "#a89e8c",
    radius: 0,
    focus: "solid",
  },
};

// Mirrors the [data-tint] recipes in styles.css: [lo, md] percentages per
// style × level (hi isn't needed — the mock has no raised chrome).
const TINT_RECIPES: Record<ThemeStyle, Record<SurfaceTint, [number, number]>> = {
  painted: { off: [0, 0], subtle: [2.5, 3.5], vivid: [7, 9] },
  minimal: { off: [0, 0], subtle: [2.5, 3.5], vivid: [7, 9] },
  noir: { off: [0, 0], subtle: [1.5, 2], vivid: [4, 5.5] },
  ember: { off: [0, 0], subtle: [3, 4], vivid: [7, 9] },
};

function mix(accent: string, pct: number, base: string): string {
  if (pct <= 0) return base;
  return `color-mix(in srgb, ${accent} ${pct}%, ${base})`;
}

export function ThemeStylePreview({
  style,
  accentId,
  tint,
}: {
  style: ThemeStyle;
  accentId: AccentColorId;
  tint: SurfaceTint;
}) {
  const accent = getAccentColor(accentId);
  const palette = STYLE_PALETTES[style];
  const [lo, md] = TINT_RECIPES[style][tint];
  const bg = mix(accent.value, lo, palette.bg);
  const surface0 = mix(accent.value, md, palette.surface0);
  const surface1 = mix(accent.value, md, palette.surface1);
  const accentRgba = (a: number) => `rgba(${accent.rgb}, ${a})`;

  const focusedPaneStyle: CSSProperties =
    palette.focus === "painted"
      ? {
          border: `2px solid ${accentRgba(0.8)}`,
          boxShadow: `0 0 10px ${accentRgba(0.4)}`,
        }
      : palette.focus === "ring"
        ? {
            border: `1px solid ${accentRgba(0.75)}`,
            boxShadow: `0 0 0 2px ${accentRgba(0.22)}`,
          }
        : palette.focus === "hairline"
          ? {
              border: `1px solid ${accentRgba(0.66)}`,
              boxShadow: `0 0 8px ${accentRgba(0.12)}`,
            }
          : {
              border: `1px solid ${accent.value}`,
              boxShadow: `0 3px 8px rgba(0, 0, 0, 0.35)`,
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
