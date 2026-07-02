// Cache key shared with the pre-hydration script in __root.tsx so the next
// launch can apply the user's minimal-mode preference before React mounts
// (no painted-chrome flash). Keep in sync with PRE_HYDRATION_THEME_SCRIPT.
export const MINIMAL_CACHE_KEY = "mc:minimal";

/** True when the cached preference selects the minimal (clean-CSS) theme. */
export function readCachedMinimalTheme(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MINIMAL_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Apply the minimal/painted theme to the document and cache the choice so the
 * pre-hydration script can restore it on the next launch. Painted mode is the
 * absence of the `data-minimal` attribute.
 */
export function applyMinimalTheme(next: boolean): void {
  if (typeof document !== "undefined") {
    if (next) {
      document.documentElement.setAttribute("data-minimal", "true");
    } else {
      document.documentElement.removeAttribute("data-minimal");
    }
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MINIMAL_CACHE_KEY, next ? "1" : "0");
  } catch {
    // ignore quota / privacy-mode errors
  }
}
