// Theme style — which chrome the app renders. Shared by the settings
// controller (persistence + validation) and the renderer (DOM application),
// so the enum lives here rather than in src/lib.
//
//  - "painted": pixel-art borders and shell imagery (the original look)
//  - "minimal": clean CSS borders, textured cards, accent-tinted surfaces
//  - "noir":    flat near-black surfaces with hairline dividers; borders only
//               where they carry meaning (e.g. the focused pane)
//  - "ember":   warm sepia near-black, edge-to-edge flush panes with square
//               corners, a bundled JetBrains Mono face, and a solid accent
//               border + soft drop shadow on the focused pane
export const THEME_STYLES = ["painted", "minimal", "noir", "ember"] as const;

export type ThemeStyle = (typeof THEME_STYLES)[number];

export const DEFAULT_THEME_STYLE: ThemeStyle = "painted";

export function isThemeStyle(value: unknown): value is ThemeStyle {
  return (
    typeof value === "string" &&
    (THEME_STYLES as readonly string[]).includes(value)
  );
}

/**
 * Styles that replace the painted borders/shell imagery with clean CSS chrome.
 * Noir and ember build on minimal's chrome (all three set `data-minimal` on
 * <html>), so layout decisions keyed on "minimal mode" apply to every non-
 * painted style.
 */
export function isCleanChromeStyle(style: ThemeStyle): boolean {
  return style !== "painted";
}
