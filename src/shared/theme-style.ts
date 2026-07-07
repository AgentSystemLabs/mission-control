// Theme style — which chrome the app renders. Shared by the settings
// controller (persistence + validation) and the renderer (DOM application),
// so the enum lives here rather than in src/lib.
//
//  - "painted": pixel-art borders and shell imagery (the original look);
//               always dark.
//  - "flat":    the one clean-chrome theme — warm sepia near-black, edge-to-
//               edge flush panes with square corners, bundled JetBrains Mono +
//               Plus Jakarta Sans faces, and a solid accent border + soft drop
//               shadow on the focused pane. Supports dark and light.
//
// Legacy note: earlier builds split the flat look into "minimal" / "noir" /
// "ember". Those values are migrated to "flat" on every READ path
// (normalizeThemeStyle); the strict guard below rejects them on WRITE.
export const THEME_STYLES = ["painted", "flat"] as const;

export type ThemeStyle = (typeof THEME_STYLES)[number];

export const DEFAULT_THEME_STYLE: ThemeStyle = "painted";

export function isThemeStyle(value: unknown): value is ThemeStyle {
  return (
    typeof value === "string" &&
    (THEME_STYLES as readonly string[]).includes(value)
  );
}

/**
 * Coerce any stored/cached value — including the legacy "minimal" / "noir" /
 * "ember" flat styles — into a current ThemeStyle. Anything flat-ish becomes
 * "flat"; anything unrecognized falls back to the default (painted). Use this
 * on every read path (server settings, client cache, pre-hydration script) so
 * old preferences upgrade cleanly.
 */
export function normalizeThemeStyle(value: unknown): ThemeStyle {
  if (value === "painted") return "painted";
  if (
    value === "flat" ||
    value === "minimal" ||
    value === "noir" ||
    value === "ember"
  ) {
    return "flat";
  }
  return DEFAULT_THEME_STYLE;
}

/**
 * Whether the style replaces the painted borders/shell imagery with clean CSS
 * chrome. Only the flat theme does; kept as a helper because layout decisions
 * key off "is this the flat theme?" (the DOM attribute is still `data-minimal`
 * for cascade-churn reasons).
 */
export function isCleanChromeStyle(style: ThemeStyle): boolean {
  return style !== "painted";
}
