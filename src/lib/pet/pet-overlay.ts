import { useEffect, useState } from "react";
import { getElectron } from "~/lib/electron";

/**
 * Whether the desktop pet overlay works on this platform — the single source
 * of truth shared by the settings toggle and the enable sync (mirrors the
 * `screenshotSupported()` pattern in src/lib/screenshot.ts).
 *
 * The floating pet is interactive via a full-screen click-through window that
 * flips itself mouse-capturing only over the sprite. That hit-test needs
 * `setIgnoreMouseEvents(..., { forward: true })` to receive pointer events while
 * click-through — an option Electron supports on macOS and Windows only. On
 * Linux the overlay renderer gets no pointer events while click-through, so the
 * pet can never be petted or dragged; `setAlwaysOnTop` is also unsupported on
 * Wayland. Gate on the main process's authoritative platform (not
 * navigator.platform). Always false outside Electron.
 */
export function petOverlaySupported(): boolean {
  const platform = getElectron()?.platform;
  return platform === "darwin" || platform === "win32";
}

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
