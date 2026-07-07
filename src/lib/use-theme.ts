import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "mc.theme";

/** localStorage key for the dark/light preference. Shared with the
 *  pre-hydration script in __root.tsx. */
export const THEME_CACHE_KEY = KEY;

/**
 * The cached dark/light preference (defaults to dark). Shared with
 * `applyThemeStyle` and the pre-hydration script so the choice survives
 * reloads with no flash. Note: only the flat theme honours "light"; painted is
 * always dark (enforced when the DOM `data-theme` is reconciled).
 */
export function readCachedTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** The flat theme is the only one that supports light; it's marked by
 *  `data-minimal` on <html> (set by applyThemeStyle / the pre-hydration
 *  script). Painted has no such attribute and stays dark. */
function isFlatActive(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-minimal") === "true"
  );
}

/** Reconcile the DOM `data-theme` with the active style: painted is always
 *  dark; flat reflects the preference. */
function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    "data-theme",
    isFlatActive() ? theme : "dark",
  );
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Dark/light theme hook. Avoids React 19 hydration mismatches by NEVER
 * rendering the `data-theme` attribute via JSX on `<html>`; instead it seeds
 * from the default and mutates `document.documentElement` post-hydration.
 *
 * The preference is always persisted, but only takes visible effect under the
 * flat theme — painted keeps `data-theme="dark"`. Switching back to flat
 * restores the stored preference (see applyThemeStyle).
 */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>("dark");

  // Restore the cached preference on mount and reconcile the DOM.
  useEffect(() => {
    const cached = readCachedTheme();
    setThemeState(cached);
    applyTheme(cached);
  }, []);

  const set = useCallback((next: Theme) => {
    setThemeState(next);
    persistTheme(next);
    applyTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      persistTheme(next);
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, toggle, set };
}
