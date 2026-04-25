import { useEffect, useState, useCallback } from "react";

export type Tweaks = {
  theme: "dark" | "light";
  density: "compact" | "regular" | "spacious";
  accent: string;
  activity: "shimmer" | "pulse" | "none";
};

const DEFAULTS: Tweaks = {
  theme: "dark",
  density: "regular",
  accent: "#7ce58a",
  activity: "shimmer",
};

const KEY = "mc.tweaks";

function applyToDocument(t: Tweaks) {
  document.documentElement.setAttribute("data-theme", t.theme);
  document.documentElement.style.setProperty("--accent", t.accent);
  // mix-in alpha variants by hex transparency suffix
  document.documentElement.style.setProperty("--accent-dim", t.accent + "26");
  document.documentElement.style.setProperty("--accent-faint", t.accent + "14");
  document.documentElement.style.setProperty("--status-running", t.accent);
  document.documentElement.setAttribute("data-density", t.density);
  document.documentElement.setAttribute("data-activity", t.activity);
}

export function useTweaks() {
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = { ...DEFAULTS, ...JSON.parse(raw) } as Tweaks;
        setTweaks(saved);
        applyToDocument(saved);
      } else {
        applyToDocument(DEFAULTS);
      }
    } catch {
      applyToDocument(DEFAULTS);
    }
  }, []);

  const setTweak = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* swallow */
      }
      applyToDocument(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setTweaks(DEFAULTS);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* swallow */
    }
    applyToDocument(DEFAULTS);
  }, []);

  return { tweaks, setTweak, reset };
}
