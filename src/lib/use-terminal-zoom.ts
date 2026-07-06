import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  TERMINAL_ZOOM_IN_EVENT,
  TERMINAL_ZOOM_OUT_EVENT,
  TERMINAL_ZOOM_RESET_EVENT,
} from "~/lib/design-meta";
import {
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  stepTerminalZoomLevel,
  terminalFontSizeForLevel,
  type TerminalZoomLevel,
} from "~/shared/terminal-zoom";
import {
  clearTerminalInstanceZoom,
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

  // Identity-stable multi-step zoom. React state doesn't update synchronously,
  // so a handler stepping several levels within one event (a big wheel delta)
  // must track the pending level itself: the ref is refreshed every render and
  // advanced synchronously on each call, letting consecutive steps chain
  // instead of all re-deriving from the same render-captured `level`.
  const levelRef = useRef(level);
  levelRef.current = level;
  const zoomBy = useCallback(
    (steps: number) => {
      const direction = steps > 0 ? 1 : -1;
      let next = levelRef.current;
      for (let i = 0; i < Math.abs(steps); i++) {
        const stepped = stepTerminalZoomLevel(next, direction);
        if (stepped === null) break;
        next = stepped;
      }
      if (next === levelRef.current) return;
      levelRef.current = next;
      writeTerminalInstanceZoom(instanceId, next);
      setOverride(next);
    },
    [instanceId],
  );

  const zoomIn = useCallback(() => zoomBy(1), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(-1), [zoomBy]);

  // Drop this terminal's override so it snaps back to the global/default level.
  // Keep levelRef coherent for any zoom step fired synchronously before re-render.
  const resetZoom = useCallback(() => {
    clearTerminalInstanceZoom(instanceId);
    levelRef.current = globalLevel;
    setOverride(null);
  }, [instanceId, globalLevel]);

  return {
    level,
    fontSize,
    zoomBy,
    zoomIn,
    zoomOut,
    resetZoom,
    canZoomIn: stepTerminalZoomLevel(level, 1) !== null,
    canZoomOut: stepTerminalZoomLevel(level, -1) !== null,
  };
}

/** Listen for global Cmd+/Cmd-/Cmd0 zoom events and apply only when this pane owns focus. */
export function useTerminalPaneZoomShortcuts(
  paneRef: RefObject<HTMLElement | null>,
  zoomIn: () => void,
  zoomOut: () => void,
  resetZoom: () => void,
) {
  useEffect(() => {
    const owns = () => !!paneRef.current?.contains(document.activeElement);
    const onZoomIn = () => {
      if (owns()) zoomIn();
    };
    const onZoomOut = () => {
      if (owns()) zoomOut();
    };
    const onReset = () => {
      if (owns()) resetZoom();
    };
    window.addEventListener(TERMINAL_ZOOM_IN_EVENT, onZoomIn);
    window.addEventListener(TERMINAL_ZOOM_OUT_EVENT, onZoomOut);
    window.addEventListener(TERMINAL_ZOOM_RESET_EVENT, onReset);
    return () => {
      window.removeEventListener(TERMINAL_ZOOM_IN_EVENT, onZoomIn);
      window.removeEventListener(TERMINAL_ZOOM_OUT_EVENT, onZoomOut);
      window.removeEventListener(TERMINAL_ZOOM_RESET_EVENT, onReset);
    };
  }, [paneRef, zoomIn, zoomOut, resetZoom]);
}

// Wheel delta (px) that must accumulate before stepping one zoom level. Keeps a
// single flick/scroll from blasting through all five levels at once, and matches
// the discrete feel of the +/- buttons rather than a continuous zoom.
const WHEEL_ZOOM_STEP_THRESHOLD = 40;

/**
 * Cmd/Ctrl + mouse wheel over this pane zooms the terminal: scroll up to zoom in,
 * scroll down to zoom out. Scoped to the pane the pointer is over (not focus), so
 * it works even before clicking into the terminal, and each pane zooms independently.
 *
 * `zoomBy` must be identity-stable (useTerminalZoom's is): the listener
 * subscribes once per pane, so `accumulated` — the partial-step scroll
 * residue — survives across zoom level changes instead of resetting to 0
 * every time a step lands.
 */
export function useTerminalPaneWheelZoom(
  paneRef: RefObject<HTMLElement | null>,
  zoomBy: (steps: number) => void,
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
      // Every full threshold-worth of scroll is one level; a big single delta
      // (one mouse notch ≈ 100-120px) can therefore step several levels at
      // once. Scroll up (deltaY < 0) zooms in, so the sign flips.
      const steps = Math.trunc(accumulated / WHEEL_ZOOM_STEP_THRESHOLD);
      if (steps !== 0) {
        accumulated -= steps * WHEEL_ZOOM_STEP_THRESHOLD;
        zoomBy(-steps);
      }
    };

    // Capture phase + non-passive so we intercept before xterm's own wheel
    // handler and preventDefault() can block the native browser zoom.
    pane.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => pane.removeEventListener("wheel", onWheel, { capture: true });
  }, [paneRef, zoomBy]);
}
