import { CLOSE_SETTINGS_EVENT } from "~/lib/design-meta";

// The settings panel renders as a Shell-level overlay floating on top of the
// live app (see `Shell` in __root.tsx) instead of as a route that swaps out the
// workspace. Keeping the underlying route mounted lets the sliding panels
// reveal the app behind them rather than a black void.
//
// Because the app stays mounted, its global keyboard shortcuts would otherwise
// keep firing behind the modal-style overlay. Non-React consumers (the window
// keydown listener in `use-hotkey` and the project route's direct listener)
// read this flag synchronously to suppress those shortcuts while settings is
// open. The Shell mirrors its React open-state here via `setSettingsOverlayOpen`.
let overlayOpen = false;

export function setSettingsOverlayOpen(open: boolean) {
  overlayOpen = open;
}

export function isSettingsOverlayOpen() {
  return overlayOpen;
}

/** Ask the open settings overlay to animate out and close itself. */
export function requestCloseSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLOSE_SETTINGS_EVENT));
}
