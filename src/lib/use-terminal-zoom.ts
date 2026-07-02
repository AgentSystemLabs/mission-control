import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import {
  TERMINAL_ZOOM_IN_EVENT,
  TERMINAL_ZOOM_OUT_EVENT,
} from "~/lib/design-meta";
import {
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  stepTerminalZoomLevel,
  terminalFontSizeForLevel,
  type TerminalZoomLevel,
} from "~/shared/terminal-zoom";
import {
  readTerminalInstanceZoom,
  writeTerminalInstanceZoom,
} from "~/lib/terminal-zoom-storage";
import { useSettings } from "~/queries";

export function useTerminalZoom(instanceId: string) {
  const { data: settings } = useSettings();
  const globalLevel = settings?.terminalZoomLevel ?? DEFAULT_TERMINAL_ZOOM_LEVEL;
  const [override, setOverride] = useState<TerminalZoomLevel | null>(() =>
    readTerminalInstanceZoom(instanceId),
  );

  const level = override ?? globalLevel;
  const fontSize = useMemo(() => terminalFontSizeForLevel(level), [level]);

  const setLevel = useCallback(
    (next: TerminalZoomLevel) => {
      writeTerminalInstanceZoom(instanceId, next);
      setOverride(next);
    },
    [instanceId],
  );

  const zoomIn = useCallback(() => {
    const next = stepTerminalZoomLevel(level, 1);
    if (next !== null) setLevel(next);
  }, [level, setLevel]);

  const zoomOut = useCallback(() => {
    const next = stepTerminalZoomLevel(level, -1);
    if (next !== null) setLevel(next);
  }, [level, setLevel]);

  return {
    level,
    fontSize,
    zoomIn,
    zoomOut,
    canZoomIn: stepTerminalZoomLevel(level, 1) !== null,
    canZoomOut: stepTerminalZoomLevel(level, -1) !== null,
  };
}

/** Listen for global Cmd+/Cmd- zoom events and apply only when this pane owns focus. */
export function useTerminalPaneZoomShortcuts(
  paneRef: RefObject<HTMLElement | null>,
  zoomIn: () => void,
  zoomOut: () => void,
) {
  useEffect(() => {
    const onZoomIn = () => {
      if (!paneRef.current?.contains(document.activeElement)) return;
      zoomIn();
    };
    const onZoomOut = () => {
      if (!paneRef.current?.contains(document.activeElement)) return;
      zoomOut();
    };
    window.addEventListener(TERMINAL_ZOOM_IN_EVENT, onZoomIn);
    window.addEventListener(TERMINAL_ZOOM_OUT_EVENT, onZoomOut);
    return () => {
      window.removeEventListener(TERMINAL_ZOOM_IN_EVENT, onZoomIn);
      window.removeEventListener(TERMINAL_ZOOM_OUT_EVENT, onZoomOut);
    };
  }, [paneRef, zoomIn, zoomOut]);
}

// Wheel delta (px) that must accumulate before stepping one zoom level. Keeps a
// single flick/scroll from blasting through all five levels at once, and matches
// the discrete feel of the +/- buttons rather than a continuous zoom.
const WHEEL_ZOOM_STEP_THRESHOLD = 40;

/**
 * Cmd/Ctrl + mouse wheel over this pane zooms the terminal: scroll up to zoom in,
 * scroll down to zoom out. Scoped to the pane the pointer is over (not focus), so
 * it works even before clicking into the terminal, and each pane zooms independently.
 */
export function useTerminalPaneWheelZoom(
  paneRef: RefObject<HTMLElement | null>,
  zoomIn: () => void,
  zoomOut: () => void,
) {
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    let accumulated = 0;
    const onWheel = (event: WheelEvent) => {
      // metaKey is Cmd on macOS; ctrlKey covers Windows/Linux and trackpad pinch.
      if (!event.metaKey && !event.ctrlKey) return;
      // Suppress the browser's own zoom and stop xterm from also scrolling its
      // scrollback on the same gesture (we run in capture, before xterm).
      event.preventDefault();
      event.stopPropagation();
      // Reset if the scroll direction flips, so up-then-down feels responsive.
      if (Math.sign(event.deltaY) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += event.deltaY;
      while (accumulated <= -WHEEL_ZOOM_STEP_THRESHOLD) {
        accumulated += WHEEL_ZOOM_STEP_THRESHOLD;
        zoomIn(); // scroll up (deltaY < 0) → larger
      }
      while (accumulated >= WHEEL_ZOOM_STEP_THRESHOLD) {
        accumulated -= WHEEL_ZOOM_STEP_THRESHOLD;
        zoomOut(); // scroll down (deltaY > 0) → smaller
      }
    };

    // Capture phase + non-passive so we intercept before xterm's own wheel
    // handler and preventDefault() can block the native browser zoom.
    pane.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => pane.removeEventListener("wheel", onWheel, { capture: true });
  }, [paneRef, zoomIn, zoomOut]);
}
