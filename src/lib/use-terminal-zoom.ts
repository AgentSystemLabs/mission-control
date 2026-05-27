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
