import { useEffect, useRef, useState } from "react";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import {
  attachTerminalKeyHandler,
  wireTerminalFileDrop,
} from "~/lib/terminal-pane-helpers";
import {
  createTerminalOptions,
  createTerminalTheme,
  getTerminalColorScheme,
  watchTerminalColorScheme,
} from "~/lib/terminal-options";
import { ApiError, api } from "~/lib/api";
import { buildClaudeCommand, newSessionId } from "~/lib/claude-command";
import { terminalInputStartsTurn } from "~/lib/task-status-sync";
import { apiTokenQueryOptions, queryKeys, useTasks } from "~/queries";
import type { Project, Task } from "~/db/schema";
import { normalizePtySize } from "~/shared/pty-size";
import { HOSTED_WORKSPACE_ROOT } from "~/shared/hosted-workspace";

async function resolveMcEnv(
  electron: NonNullable<ReturnType<typeof getElectron>>,
  queryClient: QueryClient
) {
  try {
    const [port, token] = await Promise.all([
      electron.getRuntimePort(),
      queryClient.ensureQueryData(apiTokenQueryOptions()),
    ]);
    if (!port || !token) return undefined;
    return { apiUrl: `http://127.0.0.1:${port}`, token };
  } catch {
    return undefined;
  }
}

export type TerminalDescriptor = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  dangerouslySkipPermissions: boolean;
  cwd: string;
};

export function TerminalPane({
  project,
  task,
  onClose,
  onHide,
  expanded = false,
  onToggleExpanded,
  isLast,
  descriptor,
  onPtyReady,
}: {
  project: Project;
  task: Task;
  onClose: () => void;
  onHide?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  isLast: boolean;
  descriptor: TerminalDescriptor;
  onPtyReady: (ptyId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const queryClient = useQueryClient();
  const [liveStatus, setLiveStatus] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const { data: liveTasks } = useTasks(project.id);
  const liveTask = liveTasks?.find((t) => t.id === task.id) ?? task;
  const meta = AGENT_META[liveTask.agent];
  const statusMeta = STATUS_META[liveTask.status];

  useEffect(() => {
    const electron = getElectron();
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      // Defer xterm to client-side dynamic import so SSR doesn't try to load
      // its CommonJS UMD bundle.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;

      const cursorColor = meta?.color;
      const term = new Terminal(
        createTerminalOptions({ cursorColor, colorScheme: getTerminalColorScheme() })
      );
      const fit = new FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);
      term.open(containerRef.current);
      term.focus();

      const host = containerRef.current;
      const subscriptions: Array<() => void> = [];
      let rafHandle = 0;
      let activePtyId: string | null = null;
      let fallbackRunningPosted = false;
      const stopWatchingColorScheme = watchTerminalColorScheme((colorScheme) => {
        term.options.theme = createTerminalTheme({ cursorColor, colorScheme });
      });

      const detachFileDrop = electron
        ? wireTerminalFileDrop({
            host,
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

      // If a `claude --resume <uuid>` spawn dies almost immediately, the
      // session file is gone or unreadable. Per the persistence design we
      // start fresh under a NEW uuid instead of deleting the task card.
      const RESUME_FAST_EXIT_MS = 3000;
      let spawnAt = 0;
      let spawnedAsResume = false;

      const handlePtyExit = () => {
        const elapsed = Date.now() - spawnAt;
        if (
          spawnedAsResume &&
          task.agent === "claude-code" &&
          elapsed < RESUME_FAST_EXIT_MS
        ) {
          void (async () => {
            const fresh = newSessionId();
            try {
              await api.updateTask(descriptor.taskId, { claudeSessionId: fresh });
            } catch {
              /* best effort — even if patch fails, spawn with fresh id */
            }
            term.writeln(
              `\x1b[33m[resume failed; starting a fresh Claude session]\x1b[0m`
            );
            const cmd = buildClaudeCommand({
              kind: "new",
              sessionId: fresh,
              skipPermissions: descriptor.dangerouslySkipPermissions,
              bareSession: !!task.claudeBareSession,
            });
            await spawnAndWire(cmd, false);
          })();
          return;
        }
        void (async () => {
          try {
            await api.deleteTask(descriptor.taskId);
          } catch {
            /* best effort */
          }
          await queryClient.invalidateQueries({
            queryKey: queryKeys.tasks(project.id),
          });
          onClose();
        })();
      };

      const wireTerminalInput = (ptyId: string) => {
        term.onData((data) => {
          if (!fallbackRunningPosted && terminalInputStartsTurn(task.agent, data)) {
            fallbackRunningPosted = true;
            void (async () => {
              try {
                await api.updateTaskStatus(descriptor.taskId, { status: "running" });
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: queryKeys.tasks(project.id) }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
                ]);
              } catch {
                fallbackRunningPosted = false;
              }
            })();
          }
          if (electron) {
            electron.pty.write(ptyId, data);
          } else {
            void api.writeRemotePty(ptyId, data);
          }
        });
        term.onResize(({ cols, rows }) => {
          const ptySize = normalizePtySize({ cols, rows });
          if (electron) {
            electron.pty.resize(ptyId, ptySize.cols, ptySize.rows);
          } else {
            void api.resizeRemotePty(ptyId, ptySize.cols, ptySize.rows);
          }
        });
      };

      const wireElectronPty = (ptyId: string) => {
        if (!electron) return;
        activePtyId = ptyId;
        subscriptions.push(
          electron.pty.onData((msg) => {
            if (msg.ptyId === ptyId) term.write(msg.data);
          }),
          electron.pty.onExit((msg) => {
            if (msg.ptyId !== ptyId) return;
            handlePtyExit();
          })
        );
        wireTerminalInput(ptyId);
      };

      const wireRemotePty = async (ptyId: string) => {
        activePtyId = ptyId;
        const { ticket } = await api.createRemotePtyTicket(ptyId);
        const source = new EventSource(
          `/api/remote-pty/${encodeURIComponent(ptyId)}/events?ticket=${encodeURIComponent(ticket)}`
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
              error?: string;
              replayBeforeSeq?: number;
            };
            if (msg.type === "ready") {
              markReady(msg.replayBeforeSeq ?? 0);
              return;
            }
            if (msg.type === "output" && typeof msg.data === "string") {
              if (replaying) pendingLive.push(msg.data);
              else term.write(msg.data);
            }
            if (msg.type === "exit") {
              handlePtyExit();
            }
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
        const replay = await api.replayRemotePty(ptyId, { beforeSeq: replayBeforeSeq });
        if (!cancelled && replay.data) term.write(replay.data);
        replaying = false;
        for (const chunk of pendingLive) term.write(chunk);
        pendingLive.length = 0;
        wireTerminalInput(ptyId);
      };

      const spawnAndWire = async (command: string, isResume: boolean) => {
        if (!electron) {
          setLiveStatus("starting cloud workspace");
          term.writeln("\x1b[36m[starting cloud workspace...]\x1b[0m");
        }
        const ptySize = normalizePtySize({ cols: term.cols, rows: term.rows });
        const { ptyId } = electron
          ? await electron.pty.spawn({
              taskId: descriptor.taskId,
              cwd: descriptor.cwd,
              command,
              cols: ptySize.cols,
              rows: ptySize.rows,
              agent: task.agent,
              dangerouslySkipPermissions: descriptor.dangerouslySkipPermissions,
              mcEnv: await resolveMcEnv(electron, queryClient),
            })
          : await api.createRemotePty({
              taskId: descriptor.taskId,
              cwd: descriptor.cwd || HOSTED_WORKSPACE_ROOT,
              command,
              agent: task.agent,
              cols: ptySize.cols,
              rows: ptySize.rows,
            });
        spawnAt = Date.now();
        spawnedAsResume = isResume;
        onPtyReady(ptyId);
        if (cancelled) return;
        if (electron) wireElectronPty(ptyId);
        else await wireRemotePty(ptyId);
      };

      const ensurePty = async () => {
        if (cancelled) return;
        setStartError(null);
        try {
          try {
            fit.fit();
          } catch {
            /* container not measured yet */
          }

          if (descriptor.ptyId) {
            // Re-attach to a live PTY: subscribe BEFORE replay so any chunk
            // emitted between the calls is queued, not lost.
            if (electron) {
              wireElectronPty(descriptor.ptyId);
              const buf = await electron.pty.replay(descriptor.ptyId);
              if (!cancelled && buf) term.write(buf);
            } else {
              await wireRemotePty(descriptor.ptyId);
            }
            return;
          }

          const isResume =
            task.agent === "claude-code" &&
            descriptor.startCommand.includes("--resume");
          await spawnAndWire(descriptor.startCommand, isResume);
        } catch (err: any) {
          const message = remoteStartErrorMessage(err);
          setStartError(message);
          setLiveStatus(message);
          term.writeln(`\x1b[31m[failed to start pty: ${message}]\x1b[0m`);
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
        for (const off of subscriptions) off();
        stopWatchingColorScheme();
        detachFileDrop();
        ro.disconnect();
        fitRef.current = null;
        term.dispose();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor.taskId, retryNonce]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
        overflow: "hidden",
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
      {startError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 12px",
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {liveTask.title}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "var(--mono)",
              fontSize: 10,
              marginTop: 1,
            }}
          >
            <span style={{ color: statusMeta.color }}>{statusMeta.label}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onToggleExpanded && (
            <Btn
              variant="ghost"
              size="sm"
              icon={expanded ? "minimize" : "maximize"}
              onClick={onToggleExpanded}
              title={expanded ? "Shrink session panel" : "Expand session panel"}
              aria-label={expanded ? "Shrink session panel" : "Expand session panel"}
              aria-pressed={expanded}
              style={{ width: 34, padding: 0 }}
            />
          )}
          {onHide && (
            <Btn
              variant="ghost"
              size="sm"
              icon="x"
              onClick={onHide}
              title="Hide session panel"
              aria-label="Hide session panel"
              style={{ width: 34, padding: 0 }}
            />
          )}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          position: "relative",
          background: "var(--terminal-bg)",
        }}
      >
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      </div>
    </div>
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
      return "Too many remote runtime starts. Wait a minute, then retry.";
    }
  }
  return error instanceof Error ? error.message : String(error || "unknown error");
}
