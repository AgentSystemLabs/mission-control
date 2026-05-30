import { useEffect, useRef, useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { Icon } from "~/components/ui/Icon";
import { getElectron } from "~/lib/electron";
import {
  attachTerminalKeyHandler,
  wireTerminalFileDrop,
} from "~/lib/terminal-pane-helpers";
import {
  applyTerminalFontSize,
  createTerminalOptions,
  createTerminalTheme,
  fitTerminalSurface,
  getCurrentAccentColor,
  getTerminalColorScheme,
  watchTerminalColorScheme,
} from "~/lib/terminal-options";
import { useTerminalZoom, useTerminalPaneZoomShortcuts } from "~/lib/use-terminal-zoom";
import { TerminalZoomControls } from "~/components/views/TerminalZoomControls";
import { prefetchTerminalModules } from "~/lib/prefetch-terminal-modules";
import { attachTerminalLinks } from "~/lib/terminal-links";
import { resizePtyToTerminal } from "~/lib/terminal-resize";
import {
  dataAfterReplay,
  sequencedPtyData,
  type PtyReplaySnapshot,
  type SequencedPtyData,
} from "~/lib/terminal-replay";
import { ApiError, api } from "~/lib/api";
import { CLEAR_USER_TERMINAL_EVENT } from "~/lib/design-meta";
import { isRemotePtyId } from "~/lib/pty-id";
import { isDockerSandboxRuntime } from "~/lib/sandbox-runtime";
import type { UserTerminal } from "~/db/schema";
import { normalizePtySize } from "~/shared/pty-size";
import { HOSTED_WORKSPACE_ROOT, sandboxWorkspacePath } from "~/shared/hosted-workspace";

// Pattern for the launch-URL detector (port capture group for dev-server URLs).
const LOOPBACK_URL_BASE = String.raw`\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])`;
const LOOPBACK_URL_TAIL = String.raw`(?:\/[^\s'"<>)\]]*)?`;
const LOOPBACK_URL_WITH_PORT_GROUP_REGEX = new RegExp(
  `${LOOPBACK_URL_BASE}(?::(\\d+))?${LOOPBACK_URL_TAIL}`,
  "g",
);
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function UserTerminalPane({
  terminal,
  ptyId,
  cwd,
  focused,
  onFocus,
  onPtyReady,
  onPtyExit,
  onLaunchUrlDetected,
  onHide,
  onDelete,
  onRename,
  isLast: _isLast,
}: {
  terminal: UserTerminal;
  ptyId: string | null;
  cwd: string;
  focused: boolean;
  onFocus: () => void;
  onPtyReady: (ptyId: string) => void;
  onPtyExit: () => void;
  onLaunchUrlDetected?: (url: string) => void;
  onHide: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  isLast: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const termRef = useRef<{
    focus: () => void;
    clear: () => void;
    setFontSize: (fontSize: number) => void;
  } | null>(null);
  const {
    level: zoomLevel,
    fontSize: terminalFontSize,
    zoomIn,
    zoomOut,
    canZoomIn,
    canZoomOut,
  } = useTerminalZoom(terminal.id);
  useTerminalPaneZoomShortcuts(cardRef, zoomIn, zoomOut);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState(terminal.name);
  const [domFocused, setDomFocused] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
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

  useEffect(() => {
    termRef.current?.setFontSize(terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    const onClear = () => {
      const root = cardRef.current;
      if (!root?.contains(document.activeElement)) return;
      termRef.current?.clear();
    };
    window.addEventListener(CLEAR_USER_TERMINAL_EVENT, onClear);
    return () => window.removeEventListener(CLEAR_USER_TERMINAL_EVENT, onClear);
  }, []);

  useEffect(() => {
    const electron = getElectron();
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const { Terminal, FitAddon } = await prefetchTerminalModules();
      if (cancelled || !containerRef.current) return;

      // Sandbox shell terminals route to the in-container agent via `remotePty`
      // (same method shape as the local PTY; only spawn differs). Read the setting
      // fresh; default to host. The shell starts in the project's clone dir,
      // derived from the host cwd's basename (matches the clone slug typically).
      const useSandbox = !!electron && (await isDockerSandboxRuntime(electron));
      if (cancelled) return;
      const ptyApi = electron ? (useSandbox ? electron.remotePty : electron.pty) : null;
      const sandboxCwd = sandboxWorkspacePath(cwd.split("/").filter(Boolean).pop() ?? "project");

      const term = new Terminal(
        createTerminalOptions({
          colorScheme: getTerminalColorScheme(),
          cursorColor: getCurrentAccentColor(),
          fontSize: terminalFontSize,
        })
      );
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      term.focus();
      const stopWatchingColorScheme = watchTerminalColorScheme((colorScheme) => {
        term.options.theme = createTerminalTheme({
          colorScheme,
          cursorColor: getCurrentAccentColor(),
        });
      });
      const detachLinks = attachTerminalLinks(term);
      const onFocusIn = () => onFocus();
      const focusEl = containerRef.current;
      focusEl.addEventListener("focusin", onFocusIn);

      const subscriptions: Array<() => void> = [];
      let rafHandle = 0;
      let activePtyId: string | null = null;
      let electronReplayPtyId: string | null = null;
      let electronReplayData: SequencedPtyData[] = [];
      let electronReplayExit: { ptyId: string; exitCode: number; signal?: number } | null =
        null;
      // Sandbox spawns are fire-and-forget over the WS; if the agent never acks
      // (spawned/output/exit), surface it instead of leaving the terminal blank.
      const SANDBOX_SPAWN_ACK_MS = 12_000;
      let spawnAckTimer: ReturnType<typeof setTimeout> | null = null;
      const clearSpawnAck = () => {
        if (spawnAckTimer) {
          clearTimeout(spawnAckTimer);
          spawnAckTimer = null;
        }
      };
      const armSpawnAck = (id: string) => {
        clearSpawnAck();
        spawnAckTimer = setTimeout(() => {
          spawnAckTimer = null;
          if (cancelled || activePtyId !== id) return;
          term.writeln("");
          term.writeln(
            "\x1b[33m[sandbox isn't responding — the agent never acknowledged the terminal. Check the sandbox is connected, then reopen.]\x1b[0m",
          );
        }, SANDBOX_SPAWN_ACK_MS);
      };

      const detachFileDrop = electron
        ? wireTerminalFileDrop({
            host: focusEl,
            electron,
            getActivePtyId: () => activePtyId,
            onFocus: () => term.focus(),
          })
        : () => undefined;

      if (electron) {
        attachTerminalKeyHandler({
          term,
          electron,
          getActivePtyId: () => activePtyId,
        });
      }

      const seenLaunchUrls = new Set<string>();
      const detectLaunchUrl = (data: string) => {
        if (!terminal.startCommand || !onLaunchUrlDetected) return;
        const cleaned = data.replace(ANSI_ESCAPE_REGEX, "");
        const matches = cleaned.matchAll(
          new RegExp(LOOPBACK_URL_WITH_PORT_GROUP_REGEX.source, "g"),
        );
        for (const match of matches) {
          const url = match[0]!;
          if (seenLaunchUrls.has(url)) continue;
          seenLaunchUrls.add(url);
          onLaunchUrlDetected(url);
          return;
        }
      };
      const handleExit = (exitCode?: number) => {
        activePtyId = null;
        term.writeln("");
        term.writeln(`\x1b[2m[process exited (code=${exitCode ?? "unknown"})]\x1b[0m`);
        onPtyExit();
      };
      const resizeElectronPtyToSurface = (id: string) => {
        if (!ptyApi) return Promise.resolve(false);
        return resizePtyToTerminal(term, (cols, rows) => ptyApi.resize(id, cols, rows));
      };
      const resizeRemotePtyToSurface = (id: string) =>
        resizePtyToTerminal(term, (cols, rows) => api.resizeRemotePty(id, cols, rows));
      termRef.current = {
        focus: () => term.focus(),
        clear: () => term.clear(),
        setFontSize: (nextFontSize) => {
          applyTerminalFontSize(term, fit, nextFontSize);
          const id = activePtyId;
          if (!id) return;
          if (electron) void resizeElectronPtyToSurface(id);
          else void resizeRemotePtyToSurface(id).catch(() => undefined);
        },
      };
      const wireTerminalInput = (id: string) => {
        term.onData((data) => {
          if (ptyApi) ptyApi.write(id, data);
          else void api.writeRemotePty(id, data);
        });
        term.onResize(({ cols, rows }) => {
          const ptySize = normalizePtySize({ cols, rows });
          if (ptyApi) ptyApi.resize(id, ptySize.cols, ptySize.rows);
          else void api.resizeRemotePty(id, ptySize.cols, ptySize.rows);
        });
      };
      const wireElectronPty = (id: string) => {
        if (!ptyApi) return;
        activePtyId = id;
        subscriptions.push(
          ptyApi.onData((msg) => {
            if (msg.ptyId === id) {
              clearSpawnAck(); // the agent is alive
              if (electronReplayPtyId === id) {
                electronReplayData.push(sequencedPtyData(msg.seq, msg.data));
                return;
              }
              term.write(msg.data);
              detectLaunchUrl(msg.data);
            }
          }),
          ptyApi.onExit((msg) => {
            if (msg.ptyId === id) {
              clearSpawnAck();
              if (electronReplayPtyId === id) {
                electronReplayExit = msg;
                return;
              }
              handleExit(msg.exitCode);
            }
          })
        );
        if (electron && useSandbox) {
          subscriptions.push(
            electron.remotePty.onSpawnError((msg) => {
              if (msg.ptyId !== id) return;
              clearSpawnAck();
              term.writeln("");
              term.writeln(
                `\x1b[31m[sandbox spawn failed (${msg.code})${msg.message ? `: ${msg.message}` : ""}]\x1b[0m`,
              );
              handleExit(undefined);
            }),
          );
        }
        wireTerminalInput(id);
      };
      const replayExistingElectronPty = async (id: string) => {
        if (!ptyApi) return;
        electronReplayPtyId = id;
        electronReplayData = [];
        electronReplayExit = null;
        wireElectronPty(id);
        void resizeElectronPtyToSurface(id);

        let replay: PtyReplaySnapshot = { data: "", nextSeq: 0 };
        try {
          replay = await ptyApi.replay(id);
        } finally {
          if (electronReplayPtyId === id) {
            electronReplayPtyId = null;
          }
        }
        if (cancelled || activePtyId !== id) return;

        if (replay.data) {
          term.write(replay.data);
          detectLaunchUrl(replay.data);
        }
        for (const chunk of dataAfterReplay(electronReplayData, replay)) {
          term.write(chunk);
          detectLaunchUrl(chunk);
        }
        electronReplayData = [];

        const replayExit = electronReplayExit as
          | { ptyId: string; exitCode: number; signal?: number }
          | null;
        electronReplayExit = null;
        if (replayExit) handleExit(replayExit.exitCode);
      };
      const wireRemotePty = async (id: string) => {
        activePtyId = id;
        const { ticket } = await api.createRemotePtyTicket(id);
        const source = new EventSource(
          `/api/remote-pty/${encodeURIComponent(id)}/events?ticket=${encodeURIComponent(ticket)}`
        );
        let replaying = true;
        const pendingLive: string[] = [];
        let markReady: (replayBeforeSeq: number) => void = () => undefined;
        const ready = new Promise<number>((resolve) => {
          markReady = resolve;
        });
        source.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as {
              type?: string;
              data?: string;
              exitCode?: number;
              error?: string;
              replayBeforeSeq?: number;
            };
            if (msg.type === "ready") {
              markReady(msg.replayBeforeSeq ?? 0);
              return;
            }
            if (msg.type === "output" && typeof msg.data === "string") {
              if (replaying) pendingLive.push(msg.data);
              else {
                term.write(msg.data);
                detectLaunchUrl(msg.data);
              }
            }
            if (msg.type === "exit") handleExit(msg.exitCode);
            if (msg.type === "error") {
              const message = `remote pty error: ${msg.error ?? "unknown"}`;
              setLiveStatus(message);
              term.writeln(`\x1b[31m[${message}]\x1b[0m`);
            }
          } catch {
            /* ignore malformed SSE payloads */
          }
        };
        source.onerror = () => {
          setLiveStatus("remote pty stream disconnected");
          term.writeln("\x1b[31m[remote pty stream disconnected]\x1b[0m");
          markReady(0);
          source.close();
        };
        subscriptions.push(() => source.close());
        const replayBeforeSeq = await Promise.race([
          ready,
          new Promise<number>((resolve) => setTimeout(() => resolve(0), 5000)),
        ]);
        setLiveStatus("connected to remote runtime");
        term.writeln("\x1b[36m[connected to remote runtime]\x1b[0m");
        await resizeRemotePtyToSurface(id).catch(() => undefined);
        const replay = await api.replayRemotePty(id, { beforeSeq: replayBeforeSeq });
        if (!cancelled && replay.data) {
          term.write(replay.data);
          detectLaunchUrl(replay.data);
        }
        replaying = false;
        for (const chunk of pendingLive) {
          term.write(chunk);
          detectLaunchUrl(chunk);
        }
        pendingLive.length = 0;
        wireTerminalInput(id);
      };

      const ensurePty = async () => {
        if (cancelled) return;
        setStartError(null);
        try {
          fitTerminalSurface(term, fit);

          if (ptyId) {
            if (useSandbox && electron && !isRemotePtyId(ptyId)) {
              await electron.pty.kill(ptyId).catch(() => undefined);
            } else {
              if (electron) {
                await replayExistingElectronPty(ptyId);
              } else {
                await wireRemotePty(ptyId);
              }
              return;
            }
          }

          if (!electron) {
            setLiveStatus("starting cloud workspace");
            term.writeln("\x1b[36m[starting cloud workspace...]\x1b[0m");
          }
          const ptySize = normalizePtySize({ cols: term.cols, rows: term.rows });
          const { ptyId: newId } = !electron
            ? await api.createRemotePty({
                projectId: terminal.projectId,
                cwd: cwd || HOSTED_WORKSPACE_ROOT,
                command: terminal.startCommand ?? "",
                cols: ptySize.cols,
                rows: ptySize.rows,
              })
            : useSandbox
              ? await electron.remotePty.spawn({
                  taskId: terminal.id,
                  cwd: sandboxCwd, // in-container clone dir
                  command: terminal.startCommand ?? "",
                  cols: ptySize.cols,
                  rows: ptySize.rows,
                  shell: true,
                })
              : await electron.pty.spawn({
                  taskId: terminal.id,
                  cwd,
                  command: terminal.startCommand ?? "",
                  cols: ptySize.cols,
                  rows: ptySize.rows,
                  // User-shell terminal: opts into the shell branch so the main
                  // process is willing to interpret `startCommand` through `sh -l -c`.
                  // Agent terminals (TerminalPane.tsx) leave this unset, which forces
                  // the allow-listed direct-argv spawn path instead.
                  shell: true,
                });
          if (cancelled) {
            if (ptyApi) await ptyApi.kill(newId).catch(() => undefined);
            else await api.killRemotePty(newId).catch(() => undefined);
            return;
          }
          onPtyReady(newId);
          if (electron) {
            if (useSandbox) armSpawnAck(newId); // surfaces a stuck/never-acked sandbox spawn
            wireElectronPty(newId);
          } else await wireRemotePty(newId);
        } catch (err: any) {
          const message = remoteStartErrorMessage(err);
          setStartError(message);
          setLiveStatus(message);
          term.writeln(`\x1b[31m[failed to start pty: ${message}]\x1b[0m`);
        }
      };

      rafHandle = window.requestAnimationFrame(() => ensurePty());

      const ro = new ResizeObserver(() => {
        fitTerminalSurface(term, fit);
      });
      ro.observe(containerRef.current);

      cleanup = () => {
        cancelAnimationFrame(rafHandle);
        clearSpawnAck();
        focusEl.removeEventListener("focusin", onFocusIn);
        detachFileDrop();
        detachLinks();
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
  }, [terminal.id, retryNonce]);

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
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {liveStatus}
      </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <TerminalZoomControls
            level={zoomLevel}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
          <Btn
            variant="ghost"
            size="sm"
            icon="eraser"
            onClick={() => termRef.current?.clear()}
            title="Clear terminal output"
            aria-label="Clear terminal output"
            style={{ width: 34, padding: 0 }}
          />
          <Btn
            variant="ghost"
            size="sm"
            icon="trash"
            onClick={() => setConfirmDelete(true)}
            title="Delete terminal (kills the process)"
            aria-label="Delete terminal (kills the process)"
            style={{ width: 34, padding: 0 }}
          />
          <Btn
            variant="ghost"
            size="sm"
            icon="x"
            onClick={onHide}
            title="Hide terminal (keeps it running)"
            aria-label="Hide terminal (keeps it running)"
            style={{ width: 34, padding: 0 }}
          />
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        title={`Delete terminal "${terminal.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        icon="trash"
      >
        This will kill the running process and remove the terminal. This can&apos;t be undone.
      </ConfirmDialog>
      {startError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 10px",
            borderBottom: "1px solid var(--border)",
            color: "var(--status-failed)",
            background: "color-mix(in oklch, var(--status-failed) 10%, transparent)",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
          }}
        >
          <span>{startError}</span>
          <Btn
            variant="ghost"
            size="sm"
            icon="refresh"
            onClick={() => setRetryNonce((value) => value + 1)}
          >
            Retry
          </Btn>
        </div>
      )}
      <div style={{ flex: 1, position: "relative", background: "var(--terminal-bg)" }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      </div>
    </CardFrame>
  );
}

function remoteStartErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Academy entitlement is required before hosted runtime can start.";
    }
    if (error.status === 402) {
      return error.message || "Hosted compute limit reached. Open Academy billing to upgrade or wait for the usage window to reset.";
    }
    if (error.status === 503) {
      return error.message || "Hosted remote runtime is temporarily disabled. Try again later or contact support.";
    }
    if (error.status === 429) {
      return "Too many remote terminal starts. Wait a minute, then retry.";
    }
  }
  return error instanceof Error ? error.message : String(error || "unknown error");
}
