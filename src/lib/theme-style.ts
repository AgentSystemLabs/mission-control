import {
  DEFAULT_THEME_STYLE,
  isThemeStyle,
  type ThemeStyle,
} from "~/shared/theme-style";

export { isCleanChromeStyle } from "~/shared/theme-style";
export type { ThemeStyle } from "~/shared/theme-style";

// Cache keys shared with the pre-hydration script in __root.tsx so the next
// launch can apply the user's theme style before React mounts (no painted-
// chrome flash). Keep in sync with PRE_HYDRATION_THEME_SCRIPT.
export const THEME_STYLE_CACHE_KEY = "mc:themeStyle";
// Legacy boolean cache written by builds that only knew painted/minimal.
// Still read as a fallback and written on apply so a downgraded build keeps
// (an approximation of) the choice.
export const MINIMAL_CACHE_KEY = "mc:minimal";

/** The cached style preference, falling back to the legacy minimal flag. */
export function readCachedThemeStyle(): ThemeStyle {
  if (typeof window === "undefined") return DEFAULT_THEME_STYLE;
  try {
    const value = window.localStorage.getItem(THEME_STYLE_CACHE_KEY);
    if (isThemeStyle(value)) return value;
    return window.localStorage.getItem(MINIMAL_CACHE_KEY) === "1"
      ? "minimal"
      : DEFAULT_THEME_STYLE;
  } catch {
    return DEFAULT_THEME_STYLE;
  }
}

/**
 * Apply a theme style to the document and cache the choice so the
 * pre-hydration script can restore it on the next launch.
 *
 * DOM contract: painted mode is the absence of every attribute. Minimal sets
 * `data-minimal`. Noir and ember set `data-minimal` too (both build on
 * minimal's clean-CSS chrome) and layer `data-noir` / `data-ember` on top for
 * their own flat palette, corners, and (ember) bundled font.
 */
export function applyThemeStyle(style: ThemeStyle): void {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (style === "painted") {
      root.removeAttribute("data-minimal");
    } else {
      root.setAttribute("data-minimal", "true");
    }
    if (style === "noir") {
      root.setAttribute("data-noir", "true");
    } else {
      root.removeAttribute("data-noir");
    }
    if (style === "ember") {
      root.setAttribute("data-ember", "true");
    } else {
      root.removeAttribute("data-ember");
    }
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STYLE_CACHE_KEY, style);
    window.localStorage.setItem(
      MINIMAL_CACHE_KEY,
      style === "painted" ? "0" : "1",
    );
  } catch {
    // ignore quota / privacy-mode errors
  }
}
