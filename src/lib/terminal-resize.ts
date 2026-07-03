import { normalizePtySize } from "~/shared/pty-size";

type TerminalSizeSource = {
  cols: number;
  rows: number;
};

export function resizePtyToTerminal<T>(
  term: TerminalSizeSource,
  resize: (cols: number, rows: number) => T,
): T {
  const ptySize = normalizePtySize({ cols: term.cols, rows: term.rows });
  return resize(ptySize.cols, ptySize.rows);
}

/**
 * How long an interactive resize (grid drag, window resize, wheel zoom) must
 * be quiet before the PTY is told about the new size.
 */
export const PTY_RESIZE_SETTLE_MS = 200;

/** How long a container resize must be quiet before the xterm surface refits. */
export const SURFACE_FIT_SETTLE_MS = 150;

export interface SettledFit {
  /** Debounced: (re)arms the settle timer; the fit runs once the resize is quiet. */
  schedule(): void;
  /** Drop any pending fit without firing — call when the pane unbinds. */
  cancel(): void;
}

/**
 * Trailing-debounced surface refit. Refitting xterm live during a drag resizes
 * the renderer's canvas on every cell-boundary crossing, and a WebGL canvas is
 * cleared the moment it resizes — one blank frame per crossing, which strobes
 * across every cell in the session grid. Deferring the fit until the drag
 * settles keeps the existing frame on screen throughout and reflows once.
 */
export function createSettledFit(
  fit: () => void,
  settleMs: number = SURFACE_FIT_SETTLE_MS,
): SettledFit {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    schedule() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        fit();
      }, settleMs);
    },
    cancel: clear,
  };
}

export interface SettledPtyResize {
  /** Debounced: (re)arms the settle timer with the latest size. */
  schedule(size: TerminalSizeSource): void;
  /** Drop any pending resize without firing — call from surface teardown. */
  cancel(): void;
}

/**
 * Trailing-debounced PTY resize. xterm emits a resize event for every
 * cell-boundary crossing while a pane is being dragged, and forwarding each
 * one SIGWINCHes the agent — full-screen TUIs (claude, opencode) clear and
 * repaint per signal, which reads as flicker across every session in the
 * grid. The local xterm still refits live; only the agent notification waits
 * for the drag to settle, so the TUI repaints once, at the final size.
 */
export function createSettledPtyResize(
  resize: (cols: number, rows: number) => unknown,
  settleMs: number = PTY_RESIZE_SETTLE_MS,
): SettledPtyResize {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    schedule(size) {
      const ptySize = normalizePtySize({ cols: size.cols, rows: size.rows });
      clear();
      timer = setTimeout(() => {
        timer = null;
        resize(ptySize.cols, ptySize.rows);
      }, settleMs);
    },
    cancel: clear,
  };
}
