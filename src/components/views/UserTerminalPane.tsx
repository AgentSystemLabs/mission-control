import { useEffect, useRef, useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { getCurrentAccentColor } from "~/lib/terminal-options";
import { useXtermPty } from "~/lib/use-xterm-pty";
import { XtermSurface } from "~/components/views/XtermSurface";
import { LOOPBACK_URL_RE } from "~/shared/loopback";
import { recordTaskSpawnError } from "~/lib/task-spawn-error";
import { toast } from "sonner";
import type { UserTerminal } from "~/db/schema";
import { getErrorMessage } from "~/shared/errors";

export function UserTerminalPane({
  terminal,
  ptyId,
  projectId,
  focused,
  onFocus,
  onPtyReady,
  onPtyExit,
  onLaunchUrlDetected,
  onKill,
  onRename,
  isLast: _isLast,
}: {
  terminal: UserTerminal;
  ptyId: string | null;
  projectId: string;
  focused: boolean;
  onFocus: () => void;
  onPtyReady: (ptyId: string) => void;
  onPtyExit: () => void;
  onLaunchUrlDetected?: (url: string) => void;
  onKill: () => void;
  onRename: (name: string) => void;
  isLast: boolean;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const termFocusRef = useRef<(() => void) | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(terminal.name);
  const [domFocused, setDomFocused] = useState(false);

  // Latch latest values so the stable onTerm closure always reads fresh
  // props (terminal id changes re-run the hook; the rest are mutable).
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onLaunchUrlDetectedRef = useRef(onLaunchUrlDetected);
  onLaunchUrlDetectedRef.current = onLaunchUrlDetected;
  const onPtyReadyRef = useRef(onPtyReady);
  onPtyReadyRef.current = onPtyReady;
  const onPtyExitRef = useRef(onPtyExit);
  onPtyExitRef.current = onPtyExit;

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onIn = () => setDomFocused(true);
    const onOut = () => {
      requestAnimationFrame(() => {
        const root = cardRef.current;
        if (!root) return;
        setDomFocused(root.contains(document.activeElement));
      });
    };
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    setDomFocused(el.contains(document.activeElement));
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
    };
  }, []);

  useEffect(() => setDraftName(terminal.name), [terminal.name]);

  const { containerRef, bridgeMissing } = useXtermPty({
    key: terminal.id,
    cursorColor: () => getCurrentAccentColor(),
    onTerm: ({ term, fit, electron, setActivePtyId, isCancelled }) => {
      termFocusRef.current = () => term.focus();

      term.registerLinkProvider({
        provideLinks(y, callback) {
          const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
          const links: any[] = [];
          // Fresh RegExp per call — LOOPBACK_URL_RE is a /g shared singleton
          // and we don't want to leak lastIndex across invocations.
          const regex = new RegExp(LOOPBACK_URL_RE.source, "g");
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

      const focusEl = containerRef.current;
      const onFocusIn = () => onFocusRef.current();
      focusEl?.addEventListener("focusin", onFocusIn);

      const subscriptions: Array<() => void> = [];

      const wireToPty = (id: string) => {
        setActivePtyId(id);
        const seenLaunchUrls = new Set<string>();
        const detectLaunchUrl = (data: string) => {
          if (!terminal.startCommand || !onLaunchUrlDetectedRef.current) return;
          const cleaned = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
          const matches = cleaned.matchAll(
            new RegExp(LOOPBACK_URL_RE.source, "g")
          );
          for (const match of matches) {
            const url = match[0]!;
            if (seenLaunchUrls.has(url)) continue;
            seenLaunchUrls.add(url);
            onLaunchUrlDetectedRef.current(url);
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
              setActivePtyId(null);
              term.writeln("");
              term.writeln(`\x1b[2m[process exited (code=${msg.exitCode})]\x1b[0m`);
              onPtyExitRef.current();
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
        if (isCancelled()) return;
        try {
          try {
            fit.fit();
          } catch {
            /* container not measured yet */
          }

          if (ptyId) {
            wireToPty(ptyId);
            const buf = await electron.pty.replay(ptyId);
            if (!isCancelled() && buf) term.write(buf);
            return;
          }

          const { ptyId: newId } = await electron.pty.spawn({
            taskId: terminal.id,
            projectId,
            command: terminal.startCommand ?? "",
            cols: term.cols,
            rows: term.rows,
          });
          if (isCancelled()) {
            await electron.pty.kill(newId).catch(() => undefined);
            return;
          }
          onPtyReadyRef.current(newId);
          wireToPty(newId);
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          term.writeln(`\x1b[31m[failed to start pty: ${message}]\x1b[0m`);
          const firstOccurrence = recordTaskSpawnError(terminal.id, message);
          if (firstOccurrence) {
            toast.error(`Failed to start terminal: ${message}`, {
              description: terminal.name,
            });
          }
        }
      };

      const rafHandle = window.requestAnimationFrame(() => {
        void ensurePty();
      });

      return () => {
        cancelAnimationFrame(rafHandle);
        focusEl?.removeEventListener("focusin", onFocusIn);
        for (const off of subscriptions) off();
        termFocusRef.current = null;
      };
    },
  });

  // Bring focus to the xterm when this pane becomes focused via cycling or
  // after a sibling pane is closed. Defer to the next frame so the focus call
  // lands after Chromium has finished settling focus from the unmounted pane.
  useEffect(() => {
    if (!focused) return;
    const raf = requestAnimationFrame(() => termFocusRef.current?.());
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
      ref={cardRef}
      focused={focused && domFocused}
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
      <XtermSurface containerRef={containerRef} bridgeMissing={bridgeMissing} />
    </CardFrame>
  );
}
