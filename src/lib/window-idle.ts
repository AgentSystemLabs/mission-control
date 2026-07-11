// Window-idle mode. When the app window loses focus (blur) or the document
// becomes hidden (minimized / occluded / another Space or tab), nobody is
// watching the decorative per-frame animations, so styles.css freezes the same
// repaint-heavy ones battery saver does (the session-icon stroke draw and the
// Mission Pet sprite) via `html[data-window-idle]`. The attribute clears the
// instant focus/visibility returns, so there is no visible change while the
// window is in front. This is independent of battery saver (src/lib/power-save.ts)
// and stacks with it.

import { useEffect } from "react";

let windowBlurred = false;
let documentHidden = false;

function syncWindowIdleAttribute(): void {
  document.documentElement.toggleAttribute(
    "data-window-idle",
    windowBlurred || documentHidden,
  );
}

/**
 * Drives the `data-window-idle` root attribute from window focus + document
 * visibility. Mount exactly once, in the root shell.
 */
export function useWindowIdleController(): void {
  useEffect(() => {
    windowBlurred = !document.hasFocus();
    documentHidden = document.visibilityState === "hidden";
    syncWindowIdleAttribute();

    const onBlur = () => {
      windowBlurred = true;
      syncWindowIdleAttribute();
    };
    const onFocus = () => {
      windowBlurred = false;
      syncWindowIdleAttribute();
    };
    const onVisibility = () => {
      documentHidden = document.visibilityState === "hidden";
      syncWindowIdleAttribute();
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.removeAttribute("data-window-idle");
    };
  }, []);
}
