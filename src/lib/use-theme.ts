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

  // After hydration, read the persisted preference and apply it.
  useEffect(() => {
    try {
      const saved = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const set = (t: Theme) => {
    setTheme(t);
    try {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem(KEY, t);
    } catch {
      /* swallow */
    }
  };
  const toggle = () => set(theme === "dark" ? "light" : "dark");

  return { theme, toggle, set };
}
