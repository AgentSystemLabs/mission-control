import {
  clampTerminalZoomLevel,
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  type TerminalZoomLevel,
} from "~/shared/terminal-zoom";

const INSTANCE_ZOOM_PREFIX = "mc:terminalZoom:";

function instanceZoomKey(instanceId: string): string {
  return `${INSTANCE_ZOOM_PREFIX}${instanceId}`;
}

export function readTerminalInstanceZoom(instanceId: string): TerminalZoomLevel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(instanceZoomKey(instanceId));
    if (raw === null) return null;
    return clampTerminalZoomLevel(Number(raw));
  } catch {
    return null;
  }
}

export function writeTerminalInstanceZoom(
  instanceId: string,
  level: TerminalZoomLevel,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(instanceZoomKey(instanceId), String(level));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/** Drop a terminal's per-instance zoom so it falls back to the global level. */
export function clearTerminalInstanceZoom(instanceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(instanceZoomKey(instanceId));
  } catch {
    // ignore privacy-mode errors
  }
}

export function resolveTerminalZoomLevel(
  instanceId: string,
  globalLevel: TerminalZoomLevel = DEFAULT_TERMINAL_ZOOM_LEVEL,
): TerminalZoomLevel {
  return readTerminalInstanceZoom(instanceId) ?? globalLevel;
}
