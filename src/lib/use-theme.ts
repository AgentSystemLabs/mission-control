import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "mc.theme";

/**
 * Theme hook that avoids React 19 hydration mismatches by NEVER rendering the
 * `data-theme` attribute via JSX on `<html>`. Instead we always SSR with the
 * default and mutate `document.documentElement` post-hydration.
 */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
} {
  const [theme, setTheme] = useState<Theme>("dark");

  // Theme is intentionally locked to dark for now.
  useEffect(() => {
    try {
      setTheme("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem(KEY, "dark");
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const set = (_t: Theme) => {
    const next: Theme = "dark";
    setTheme(next);
    try {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(KEY, next);
    } catch {
      /* swallow */
    }
  };
  const toggle = () => set(theme === "dark" ? "light" : "dark");

  return { theme, toggle, set };
}
