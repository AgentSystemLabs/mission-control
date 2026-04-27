import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/ui/Icon";
import { getElectron } from "~/lib/electron";
import type { UserTerminal } from "~/db/schema";

export function UserTerminalPane({
  terminal,
  ptyId,
  cwd,
  focused,
  onFocus,
  onPtyReady,
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

      const term = new Terminal({
        fontFamily: 'Geist Mono, ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.4,
        cursorBlink: true,
        theme: {
          background: "#050607",
          foreground: "#e8e6df",
          cursor: "#7ce58a",
          black: "#0a0b0d",
          brightBlack: "#22262c",
          white: "#e8e6df",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      termRef.current = { focus: () => term.focus() };
      term.focus();
      const onFocusIn = () => onFocus();
      const focusEl = containerRef.current;
      focusEl.addEventListener("focusin", onFocusIn);

      const subscriptions: Array<() => void> = [];
      let rafHandle = 0;

      const wireToPty = (id: string) => {
        subscriptions.push(
          electron.pty.onData((msg) => {
            if (msg.ptyId === id) term.write(msg.data);
          }),
          electron.pty.onExit((msg) => {
            if (msg.ptyId === id) {
              term.writeln("");
              term.writeln(`\x1b[2m[process exited (code=${msg.exitCode})]\x1b[0m`);
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
            command: "",
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

  // Bring focus to the xterm when this pane becomes focused via cycling.
  useEffect(() => {
    if (focused) termRef.current?.focus();
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
    <div
      onMouseDown={onFocus}
      style={{
        flex: 1,
        minWidth: 200,
        display: "flex",
        flexDirection: "column",
        borderRight: isLast ? "none" : "1px solid var(--border)",
        overflow: "hidden",
        outline: focused ? "1px solid var(--accent)" : "none",
        outlineOffset: -1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--surface-1)",
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
      <div style={{ flex: 1, position: "relative", background: "#050607" }}>
        {bridgeMissing ? (
          <div style={{ padding: 16, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}>
            Terminals require the Electron runtime.
          </div>
        ) : (
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        )}
      </div>
    </div>
  );
}
