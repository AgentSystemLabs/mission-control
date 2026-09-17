// Cache key shared with the pre-hydration script in __root.tsx so the next
// launch knows the grid is off before React mounts (no grid-then-blank flash
// on every window open). Keep in sync with PRE_HYDRATION_THEME_SCRIPT.
export const BACKGROUND_GRID_CACHE_KEY = "mc:backgroundGridOff";

/** True when the stored preference says the grid ground is turned off. */
export function readCachedBackgroundGridOff(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BACKGROUND_GRID_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Apply (or clear) the grid ground on the document and cache the choice so the
 * pre-hydration script can restore it on the next launch.
 *
 * DOM contract: `data-bg-grid="off"` on <html> blanks `.dot-grid-bg` (see
 * styles.css), which is the only class that paints the pattern — painted's
 * white dot grid and flat's accent blueprint alike. Showing the grid removes
 * the attribute rather than setting "on", so the default needs no attribute.
 */
export function applyBackgroundGrid(visible: boolean): void {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (visible) {
      root.removeAttribute("data-bg-grid");
    } else {
      root.setAttribute("data-bg-grid", "off");
    }
  }
  if (typeof window === "undefined") return;
  try {
    if (visible) {
      window.localStorage.removeItem(BACKGROUND_GRID_CACHE_KEY);
    } else {
      window.localStorage.setItem(BACKGROUND_GRID_CACHE_KEY, "1");
    }
  } catch {
    // ignore quota / privacy-mode errors — the server copy is the source of truth
  }
}
