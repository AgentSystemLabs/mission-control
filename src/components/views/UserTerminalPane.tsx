import { useEffect, useRef, useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { getElectron } from "~/lib/electron";
import { mapTerminalKey, shouldSuppressTerminalKey } from "~/lib/terminal-keymap";
import {
  createTerminalOptions,
  createTerminalTheme,
  getCurrentAccentColor,
  getTerminalColorScheme,
  watchTerminalColorScheme,
} from "~/lib/terminal-options";
import type { UserTerminal } from "~/db/schema";

export function UserTerminalPane({
  terminal,
  ptyId,
  cwd,
  focused,
  onFocus,
  onPtyReady,
  onPtyExit,
  onLaunchUrlDetected,
  onKill,
  onRename,
  isLast,
}: {
  terminal: UserTerminal;
  ptyId: string | null;
  cwd: string;
  focused: boolean;
  onFocus: () => void;
  onPtyReady: (ptyId: string) => void;
  onPtyExit: () => void;
  onLaunchUrlDetected?: (url: string) => void;
  onKill: () => void;
  onRename: (name: string) => void;
  isLast: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ focus: () => void } | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(terminal.name);

  useEffect(() => setDraftName(terminal.name), [terminal.name]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron) {
      setBridgeMissing(true);
      return;
    }
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const term = new Terminal(
        createTerminalOptions({
          colorScheme: getTerminalColorScheme(),
          cursorColor: getCurrentAccentColor(),
        })
      );
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      termRef.current = { focus: () => term.focus() };
      term.focus();
      const stopWatchingColorScheme = watchTerminalColorScheme((colorScheme) => {
        term.options.theme = createTerminalTheme({
          colorScheme,
          cursorColor: getCurrentAccentColor(),
        });
      });
      term.registerLinkProvider({
        provideLinks(y, callback) {
          const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
          const links: any[] = [];
          const regex = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s'"<>)\]]*)?/g;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            const text = match[0]!;
            links.push({
              text,
              range: {
                start: { x: match.index + 1, y: 1 },
                end: { x: match.index + text.length, y: 1 },
              },
              activate(event: MouseEvent, uri: string) {
                if (event.metaKey || event.ctrlKey) {
                  void electron.openExternal(uri);
                }
              },
            });
          }
          callback(links);
        },
      });
      const onFocusIn = () => onFocus();
      const focusEl = containerRef.current;
      focusEl.addEventListener("focusin", onFocusIn);

      // Dropped files paste their paths into the PTY, matching iTerm/Terminal.app.
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
      focusEl.addEventListener("dragover", onDragOver);
      focusEl.addEventListener("drop", onDrop);

      const subscriptions: Array<() => void> = [];
      let rafHandle = 0;
      let activePtyId: string | null = null;

      // Shift+Enter must insert a newline in Claude Code's prompt; xterm.js
      // otherwise emits plain CR. Send ESC+CR (the same sequence
      // `claude /terminal-setup` wires up for iTerm2/Terminal.app).
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

      const wireToPty = (id: string) => {
        activePtyId = id;
        const seenLaunchUrls = new Set<string>();
        const detectLaunchUrl = (data: string) => {
          if (!terminal.startCommand || !onLaunchUrlDetected) return;
          const cleaned = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
          const matches = cleaned.matchAll(
            /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?(?:\/[^\s'"<>)\]]*)?/g
          );
          for (const match of matches) {
            const url = match[0]!;
            if (seenLaunchUrls.has(url)) continue;
            seenLaunchUrls.add(url);
            onLaunchUrlDetected(url);
            return;
          }
        };
        subscriptions.push(
          electron.pty.onData((msg) => {
            if (msg.ptyId === id) {
              term.write(msg.data);
              detectLaunchUrl(msg.data);
            }
          }),
          electron.pty.onExit((msg) => {
            if (msg.ptyId === id) {
              activePtyId = null;
              term.writeln("");
              term.writeln(`\x1b[2m[process exited (code=${msg.exitCode})]\x1b[0m`);
              onPtyExit();
            }
          })
        );
        term.onData((data) => {
          electron.pty.write(id, data);
        });
        term.onResize(({ cols, rows }) => {
          electron.pty.resize(id, cols, rows);
        });
      };

      const ensurePty = async () => {
        if (cancelled) return;
        try {
          try {
            fit.fit();
          } catch {
            /* container not measured yet */
          }

          if (ptyId) {
            wireToPty(ptyId);
            const buf = await electron.pty.replay(ptyId);
            if (!cancelled && buf) term.write(buf);
            return;
          }

          const { ptyId: newId } = await electron.pty.spawn({
            taskId: terminal.id,
            cwd,
            command: terminal.startCommand ?? "",
            cols: term.cols,
            rows: term.rows,
          });
          if (cancelled) {
            await electron.pty.kill(newId).catch(() => undefined);
            return;
          }
          onPtyReady(newId);
          wireToPty(newId);
        } catch (err: any) {
          term.writeln(`\x1b[31m[failed to start pty: ${err?.message || err}]\x1b[0m`);
        }
      };

      rafHandle = window.requestAnimationFrame(() => ensurePty());

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* swallow */
        }
      });
      ro.observe(containerRef.current);

      cleanup = () => {
        cancelAnimationFrame(rafHandle);
        focusEl.removeEventListener("focusin", onFocusIn);
        focusEl.removeEventListener("dragover", onDragOver);
        focusEl.removeEventListener("drop", onDrop);
        stopWatchingColorScheme();
        for (const off of subscriptions) off();
        ro.disconnect();
        term.dispose();
        termRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal.id]);

  // Bring focus to the xterm when this pane becomes focused via cycling or
  // after a sibling pane is closed. Defer to the next frame so the focus call
  // lands after Chromium has finished settling focus from the unmounted pane.
  useEffect(() => {
    if (!focused) return;
    const raf = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [focused]);

  const commitRename = () => {
    setEditing(false);
    if (draftName.trim() && draftName.trim() !== terminal.name) {
      onRename(draftName);
    } else {
      setDraftName(terminal.name);
    }
  };

  return (
    <CardFrame
      focused={focused}
      onMouseDown={onFocus}
      style={{
        flex: 1,
        minWidth: 200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--terminal-bg)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <Icon name="terminal" size={11} style={{ color: "var(--text-faint)" }} />
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                setEditing(false);
                setDraftName(terminal.name);
              }
            }}
            style={{
              flex: 1,
              background: "var(--surface-0)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              padding: "1px 5px",
              borderRadius: 3,
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
            style={{
              flex: 1,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: "text",
            }}
          >
            {terminal.name}
          </span>
        )}
        <button
          onClick={onKill}
          title="Kill terminal"
          style={{
            background: "transparent",
            border: 0,
            padding: 4,
            color: "var(--text-faint)",
            cursor: "pointer",
            display: "flex",
          }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div style={{ flex: 1, position: "relative", background: "var(--terminal-bg)" }}>
        {bridgeMissing ? (
          <div style={{ padding: 16, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
            Terminals require the Electron runtime.
          </div>
        ) : (
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        )}
      </div>
    </CardFrame>
  );
}
