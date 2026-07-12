import { useEffect, useState } from "react";
import { getElectron } from "~/lib/electron";

// The pet desktop overlay window loads the same renderer with `?overlay=pet`.
// This flag lets the root component render ONLY the pet (no shell chrome) in
// that window, and lets the in-window pet stand down while the overlay owns it.
export function isPetOverlayWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("overlay") === "pet";
  } catch {
    return false;
  }
}

/**
 * Tracks whether the pet is currently unleashed onto the desktop overlay.
 * The main window uses this to stand its in-window pet down while the overlay
 * owns it. Always false outside Electron.
 */
export function usePetOverlayEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const overlay = getElectron()?.petOverlay;
    if (!overlay) return;
    let alive = true;
    void overlay.getState().then((state) => {
      if (alive) setEnabled(state.enabled);
    });
    const unsubscribe = overlay.onStateChange((state) => setEnabled(state.enabled));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return enabled;
}
