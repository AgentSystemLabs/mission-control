import {
  DEFAULT_SURFACE_TINT,
  isSurfaceTint,
  type SurfaceTint,
} from "~/shared/surface-tint";

export type { SurfaceTint } from "~/shared/surface-tint";

// Cache key shared with the pre-hydration script in __root.tsx so the next
// launch can apply the user's tint before React mounts (no untinted flash).
// Keep in sync with PRE_HYDRATION_THEME_SCRIPT.
export const SURFACE_TINT_CACHE_KEY = "mc:surfaceTint";

/** The cached tint preference, defaulting to subtle. */
export function readCachedSurfaceTint(): SurfaceTint {
  if (typeof window === "undefined") return DEFAULT_SURFACE_TINT;
  try {
    const value = window.localStorage.getItem(SURFACE_TINT_CACHE_KEY);
    return isSurfaceTint(value) ? value : DEFAULT_SURFACE_TINT;
  } catch {
    return DEFAULT_SURFACE_TINT;
  }
}

/**
 * Apply a surface tint to the document and cache the choice so the
 * pre-hydration script can restore it on the next launch.
 *
 * DOM contract: "off" is the absence of the attribute — every surface token
 * computes to its style's exact base value. "subtle"/"vivid" set
 * `data-tint`, which the per-style blocks in styles.css read to raise the
 * accent percentage mixed into --bg/--surface-*\/--terminal-bg.
 */
export function applySurfaceTint(tint: SurfaceTint): void {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (tint === "off") {
      root.removeAttribute("data-tint");
    } else {
      root.setAttribute("data-tint", tint);
    }
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SURFACE_TINT_CACHE_KEY, tint);
  } catch {
    // ignore quota / privacy-mode errors
  }
}
