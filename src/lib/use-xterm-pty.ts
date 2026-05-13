import { useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { getElectron } from "~/lib/electron";
import { mapTerminalKey, shouldSuppressTerminalKey } from "~/lib/terminal-keymap";
import {
  createTerminalOptions,
  createTerminalTheme,
  getTerminalColorScheme,
  watchTerminalColorScheme,
} from "~/lib/terminal-options";

type Electron = NonNullable<ReturnType<typeof getElectron>>;

/**
 * Context handed to the consumer's `onTerm` callback once xterm.js has
 * mounted. The consumer is responsible for PTY spawn/replay/wiring and
 * returning a cleanup function for its own subscriptions.
 */
export type XtermPtyContext = {
  term: XTerm;
  fit: XFitAddon;
  electron: Electron;
  /** Read the currently-attached PTY id, kept in sync via setActivePtyId. */
  getActivePtyId: () => string | null;
  /**
   * Update the active PTY id. Required so drag-drop and the custom key
   * handler can route bytes to the correct PTY without the consumer
   * re-wiring those handlers on each spawn.
   */
  setActivePtyId: (id: string | null) => void;
  /** True after the cleanup hook has fired; cheap effect-cancellation flag. */
  isCancelled: () => boolean;
};

export type UseXtermPtyOptions = {
  /**
   * Stable key (e.g. taskId / terminalId) — the hook re-runs only when this
   * changes, matching the previous in-place behavior of TerminalPane and
   * UserTerminalPane.
   */
  key: string;
  /** Cursor color forwarded to xterm theme. */
  cursorColor?: string | (() => string | undefined);
  /**
   * Main lifecycle body. Called once xterm + FitAddon are mounted; receives
   * the context and may return a cleanup function for any subscriptions it
   * created. The hook owns xterm disposal, theme watching, drag-drop, the
   * custom key handler, and the ResizeObserver — the consumer should not
   * duplicate those.
   */
  onTerm: (ctx: XtermPtyContext) => void | (() => void) | Promise<void | (() => void)>;
};

export type UseXtermPtyResult = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bridgeMissing: boolean;
};

/**
 * Shared xterm.js + PTY bootstrap. Handles the parts that are identical
 * across TerminalPane (task agent) and UserTerminalPane (user shell):
 *
 *  - Client-side dynamic import of @xterm/xterm + @xterm/addon-fit
 *  - Terminal construction with theme + color-scheme media listener
 *  - Drag-and-drop file path paste (matches iTerm/Terminal.app)
 *  - mapTerminalKey / shouldSuppressTerminalKey custom key handler
 *  - ResizeObserver-driven FitAddon.fit()
 *  - Bridge-missing detection (no Electron preload → terminal disabled)
 *  - Strict cleanup with a cancelled flag
 *
 * PTY spawn, replay, data/exit subscriptions, status-sync, and link
 * providers are intentionally NOT shared — they diverge between the two
 * consumers. They run inside `onTerm`.
 */
export function useXtermPty(options: UseXtermPtyOptions): UseXtermPtyResult {
  const { key, onTerm } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);

  // Latch onTerm + cursorColor in refs so consumers can pass inline
  // closures without forcing the hook to re-run on every render.
  const onTermRef = useRef(onTerm);
  onTermRef.current = onTerm;
  const cursorColorOption = options.cursorColor;
  const cursorColorRef = useRef(cursorColorOption);
  cursorColorRef.current = cursorColorOption;

  useEffect(() => {
    const electron = getElectron();
    if (!electron) {
      setBridgeMissing(true);
      return;
    }
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const resolveCursorColor = (): string | undefined => {
      const c = cursorColorRef.current;
      return typeof c === "function" ? c() : c;
    };

    void (async () => {
      // Defer xterm to client-side dynamic import so SSR doesn't try to load
      // its CommonJS UMD bundle.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const term = new Terminal(
        createTerminalOptions({
          cursorColor: resolveCursorColor(),
          colorScheme: getTerminalColorScheme(),
        })
      );
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      term.focus();

      const host = containerRef.current;
      let activePtyId: string | null = null;
      const getActivePtyId = () => activePtyId;
      const setActivePtyId = (id: string | null) => {
        activePtyId = id;
      };

      const stopWatchingColorScheme = watchTerminalColorScheme((colorScheme) => {
        term.options.theme = createTerminalTheme({
          cursorColor: resolveCursorColor(),
          colorScheme,
        });
      });

      // Dropping a file from Finder pastes its path into the PTY, matching
      // iTerm/Terminal.app behavior. Claude Code reads images by path.
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      };
      const onDrop = (e: DragEvent) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        if (!activePtyId) return;
        const paths = files
          .map((f) => electron.getPathForFile(f))
          .filter(Boolean)
          .map((p) => (/[\s"'\\]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p));
        if (!paths.length) return;
        electron.pty.write(activePtyId, paths.join(" ") + " ");
        term.focus();
      };
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);

      // Shift+Enter must insert a literal newline in Claude Code's prompt;
      // xterm.js otherwise emits plain CR for both Enter and Shift+Enter,
      // which Claude treats as submit. Send ESC+CR (alt-enter), the same
      // sequence `claude /terminal-setup` registers for iTerm2/Terminal.app.
      // preventDefault is required: returning false makes xterm.js bail
      // before its own preventDefault, so the hidden textarea would also
      // insert `\n` and xterm's input handler would write it to the PTY.
      term.attachCustomKeyEventHandler((e) => {
        const bytes = mapTerminalKey(e);
        if (bytes === null) {
          if (!shouldSuppressTerminalKey(e)) return true;
          e.preventDefault();
          return false;
        }
        e.preventDefault();
        if (activePtyId) electron.pty.write(activePtyId, bytes);
        return false;
      });

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* swallow */
        }
      });
      ro.observe(host);

      let consumerCleanup: (() => void) | undefined;
      try {
        const result = await onTermRef.current({
          term,
          fit,
          electron,
          getActivePtyId,
          setActivePtyId,
          isCancelled: () => cancelled,
        });
        if (typeof result === "function") consumerCleanup = result;
      } catch (err: any) {
        try {
          term.writeln(`\x1b[31m[failed to start pty: ${err?.message || err}]\x1b[0m`);
        } catch {
          /* terminal may already be disposed */
        }
      }

      cleanup = () => {
        consumerCleanup?.();
        stopWatchingColorScheme();
        host.removeEventListener("dragover", onDragOver);
        host.removeEventListener("drop", onDrop);
        ro.disconnect();
        term.dispose();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { containerRef, bridgeMissing };
}
