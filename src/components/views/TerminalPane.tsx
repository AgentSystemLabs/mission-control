import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import {
  AGENT_META,
  DUPLICATE_ACTIVE_SESSION_EVENT,
  STATUS_META,
} from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { consumeIntentionalSessionClose } from "~/lib/intentional-session-close";
import { isRemotePtyId } from "~/lib/pty-id";
import { isDockerSandboxRuntime } from "~/lib/sandbox-runtime";
import {
  attachTerminalKeyHandler,
  wireTerminalFileDrop,
} from "~/lib/terminal-pane-helpers";
import {
  applyTerminalFontSize,
  createTerminalOptions,
  createTerminalTheme,
  fitTerminalSurface,
  getTerminalColorScheme,
  watchTerminalColorScheme,
} from "~/lib/terminal-options";
import { useTerminalZoom, useTerminalPaneZoomShortcuts } from "~/lib/use-terminal-zoom";
import { TerminalZoomControls } from "~/components/views/TerminalZoomControls";
import { ApiError, api, resolveApiToken } from "~/lib/api";
import {
  agentUsesPersistedSession,
  buildFreshAgentLaunchCommand,
  isAgentResumeCommand,
  newSessionId,
} from "~/lib/agent-command";
import { terminalInputStartsTurn, agentUsesTerminalPromptFallback } from "~/lib/task-status-sync";
import { accumulateTerminalPrompt } from "~/lib/terminal-prompt-capture";
import { prefetchTerminalModules } from "~/lib/prefetch-terminal-modules";
import { attachTerminalLinks } from "~/lib/terminal-links";
import { resizePtyToTerminal } from "~/lib/terminal-resize";
import {
  appendBoundedSequencedData,
  dataAfterReplay,
  replayDataOrFallback,
  sequencedPtyData,
  type PtyReplaySnapshot,
  type SequencedPtyData,
} from "~/lib/terminal-replay";
import { queryKeys, useTasks } from "~/queries";
import type { Project, Task } from "~/db/schema";
import { normalizePtySize } from "~/shared/pty-size";
import { HOSTED_WORKSPACE_ROOT, sandboxWorkspacePath, workspaceSlug } from "~/shared/hosted-workspace";
import { AGENT_REGISTRY } from "~/shared/agents";

async function resolveMcEnv(electron: NonNullable<ReturnType<typeof getElectron>>) {
  try {
    const [port, token] = await Promise.all([
      electron.getRuntimePort(),
      resolveApiToken(),
    ]);
    if (!port || !token) return undefined;
    return { apiUrl: `http://127.0.0.1:${port}`, token };
  } catch {
    return undefined;
  }
}

function displayCloneRemote(remote: string): string {
  try {
    const url = new URL(remote);
    if (
      url.password ||
      url.search ||
      url.hash ||
      ((url.protocol === "http:" || url.protocol === "https:") && url.username)
    ) {
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    // SCP-style SSH remotes don't parse as URLs and don't carry URL userinfo.
  }
  return remote;
}

export type TerminalDescriptor = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  dangerouslySkipPermissions: boolean;
  cwd: string;
  awaitingCreate?: boolean;
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
  project: Project & { activeWorktreeId?: string | null };
  task: Task;
  onClose: () => void;
  onHide?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  isLast: boolean;
  descriptor: TerminalDescriptor;
  onPtyReady: (ptyId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const termSurfaceRef = useRef<{ setFontSize: (fontSize: number) => void } | null>(null);
  const queryClient = useQueryClient();
  const [liveStatus, setLiveStatus] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isSandboxTerminal, setIsSandboxTerminal] = useState(false);
  // When a sandbox project's repo isn't cloned into the container yet, offer to
  // clone it (remote detected from the host project) instead of opening empty.
  const [cloneOffer, setCloneOffer] = useState<{ remote: string; slug: string } | null>(null);
  const [cloning, setCloning] = useState(false);
  const {
    level: zoomLevel,
    fontSize: terminalFontSize,
    zoomIn,
    zoomOut,
    canZoomIn,
    canZoomOut,
  } = useTerminalZoom(descriptor.taskId);
  useTerminalPaneZoomShortcuts(paneRef, zoomIn, zoomOut);

  const { data: liveTasks } = useTasks(project.id, project.activeWorktreeId ?? null);
  const liveTask = liveTasks?.find((t) => t.id === task.id) ?? task;
  const meta = AGENT_META[liveTask.agent];
  const statusMeta = STATUS_META[liveTask.status];

  const requestSessionClone = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(DUPLICATE_ACTIVE_SESSION_EVENT));
  };

  useEffect(() => {
    termSurfaceRef.current?.setFontSize(terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    const electron = getElectron();
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const { Terminal, FitAddon } = await prefetchTerminalModules();
      if (cancelled || !containerRef.current) return;

      // Sandbox terminals (Terminal runtime = Docker sandbox) talk to the
      // in-container agent via `remotePty`; host terminals use the local PTY.
      // `remotePty` mirrors `pty`'s method shape, so only spawn differs below.
      // Read the runtime setting fresh at terminal start; default to host.
      const useSandbox = !!electron && (await isDockerSandboxRuntime(electron));
      if (cancelled) return;
      setIsSandboxTerminal(useSandbox);
      const ptyApi = electron ? (useSandbox ? electron.remotePty : electron.pty) : null;
      const sandboxPathName = project.path.split("/").filter(Boolean).pop() ?? project.name;
      const sandboxCwd = sandboxWorkspacePath(sandboxPathName);

      const cursorColor = meta?.color;
      const term = new Terminal(
        createTerminalOptions({
          cursorColor,
          colorScheme: getTerminalColorScheme(),
          fontSize: terminalFontSize,
        })
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
      const pendingElectronData = new Map<string, SequencedPtyData[]>();
      const pendingElectronExit = new Map<
        string,
        { ptyId: string; exitCode: number; signal?: number }
      >();
      const PENDING_ELECTRON_OUTPUT_MAX_CHARS = 64_000;
      let electronReplayPtyId: string | null = null;
      let electronReplayData: SequencedPtyData[] = [];
      let electronReplayExit: { ptyId: string; exitCode: number; signal?: number } | null =
        null;
      let fallbackRunningPosted = false;
      let promptCaptureBuffer = "";
      let promptTitlePosted = false;
      // Sandbox spawns are fire-and-forget over the WS; if the agent never acks
      // (spawned/output/exit), the terminal would otherwise sit blank forever.
      // Arm a watchdog on spawn and clear it on the first sign of life.
      const SANDBOX_SPAWN_ACK_MS = 12_000;
      let spawnAckTimer: ReturnType<typeof setTimeout> | null = null;
      const clearSpawnAck = () => {
        if (spawnAckTimer) {
          clearTimeout(spawnAckTimer);
          spawnAckTimer = null;
        }
      };
      const armSpawnAck = (ptyId: string) => {
        clearSpawnAck();
        spawnAckTimer = setTimeout(() => {
          spawnAckTimer = null;
          if (cancelled || activePtyId !== ptyId) return;
          const hint =
            "sandbox isn't responding — the agent never acknowledged the terminal. Check the sandbox is connected, then retry.";
          setStartError(hint);
          setLiveStatus(hint);
          term.writeln(`\x1b[33m[${hint}]\x1b[0m`);
        }, SANDBOX_SPAWN_ACK_MS);
      };
      const stopWatchingColorScheme = watchTerminalColorScheme((colorScheme) => {
        term.options.theme = createTerminalTheme({ cursorColor, colorScheme });
      });
      const detachLinks = attachTerminalLinks(term);

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

      // If an agent process exits before it has had a chance to render its
      // first useful prompt, preserve the panel so the user can read the error.
      const START_FAILURE_EXIT_MS = 3000;
      // If a resume spawn dies almost immediately, the session file is gone or
      // unreadable. Per the persistence design we start fresh instead of
      // deleting the task card.
      let spawnAt = 0;
      let spawnedAsResume = false;

      const clearActivePty = () => {
        activePtyId = null;
        onPtyReady(null);
      };

      const handlePtyExit = (exitCode?: number) => {
        const elapsed = Date.now() - spawnAt;
        if (
          spawnedAsResume &&
          agentUsesPersistedSession(task.agent) &&
          elapsed < START_FAILURE_EXIT_MS
        ) {
          void (async () => {
            const fresh =
              task.agent === "codex" || task.agent === "opencode" ? null : newSessionId();
            try {
              await api.updateTask(descriptor.taskId, { claudeSessionId: fresh });
            } catch {
              /* best effort — even if patch fails, spawn with fresh id */
            }
            term.writeln(
              `\x1b[33m[resume failed; starting a fresh ${AGENT_REGISTRY[task.agent].label} session]\x1b[0m`
            );
            const cmd = buildFreshAgentLaunchCommand(
              { ...task, claudeSessionId: fresh },
              fresh ?? "",
            );
            try {
              await spawnAndWire(cmd, false);
            } catch (err) {
              const message = remoteStartErrorMessage(err);
              clearActivePty();
              setStartError(message);
              setLiveStatus(message);
              term.writeln(`\x1b[31m[failed to start pty: ${message}]\x1b[0m`);
            }
          })();
          return;
        }
        if (elapsed < START_FAILURE_EXIT_MS) {
          clearActivePty();
          const code = exitCode ?? "unknown";
          const message = `Session exited immediately (code=${code}). Review the terminal output above, then retry.`;
          setStartError(message);
          setLiveStatus(message);
          term.writeln("");
          term.writeln(`\x1b[31m[${message}]\x1b[0m`);
          return;
        }
        if (cancelled || consumeIntentionalSessionClose(descriptor.taskId)) {
          return;
        }
        void (async () => {
          try {
            await api.deleteTask(descriptor.taskId);
          } catch {
            /* best effort */
          }
          await queryClient.invalidateQueries({
            queryKey: queryKeys.tasks(project.id, project.activeWorktreeId ?? null),
          });
          onClose();
        })();
      };

      if (ptyApi) {
        subscriptions.push(
          ptyApi.onData((msg) => {
            if (activePtyId === msg.ptyId) {
              clearSpawnAck(); // the agent is alive
              if (electronReplayPtyId === msg.ptyId) {
                appendBoundedSequencedData(
                  electronReplayData,
                  sequencedPtyData(msg.seq, msg.data),
                  PENDING_ELECTRON_OUTPUT_MAX_CHARS,
                );
                return;
              }
              term.write(msg.data);
              return;
            }
            const chunks = pendingElectronData.get(msg.ptyId) ?? [];
            appendBoundedSequencedData(
              chunks,
              sequencedPtyData(msg.seq, msg.data),
              PENDING_ELECTRON_OUTPUT_MAX_CHARS,
            );
            pendingElectronData.set(msg.ptyId, chunks);
          }),
          ptyApi.onExit((msg) => {
            if (activePtyId === msg.ptyId) {
              clearSpawnAck();
              if (electronReplayPtyId === msg.ptyId) {
                electronReplayExit = msg;
                return;
              }
              handlePtyExit(msg.exitCode);
              return;
            }
            pendingElectronExit.set(msg.ptyId, msg);
          })
        );
      }

      // Remote spawns fail asynchronously via spawnError (the agent rejected the
      // spawn — e.g. the agent binary isn't installed in the image). Surface it so
      // the terminal doesn't just sit blank.
      if (electron && useSandbox) {
        subscriptions.push(
          electron.remotePty.onSpawnError((msg) => {
            if (activePtyId !== msg.ptyId) return;
            clearSpawnAck();
            const hint = `sandbox spawn failed (${msg.code})${msg.message ? `: ${msg.message}` : ""}`;
            clearActivePty();
            setStartError(hint);
            setLiveStatus(hint);
            term.writeln(`\x1b[31m[${hint}]\x1b[0m`);
          })
        );
      }

      const resizeElectronPtyToSurface = (ptyId: string) => {
        if (!ptyApi) return Promise.resolve(false);
        return resizePtyToTerminal(term, (cols, rows) => ptyApi.resize(ptyId, cols, rows));
      };

      const resizeRemotePtyToSurface = (ptyId: string) =>
        resizePtyToTerminal(term, (cols, rows) => api.resizeRemotePty(ptyId, cols, rows));

      termSurfaceRef.current = {
        setFontSize: (nextFontSize) => {
          applyTerminalFontSize(term, fit, nextFontSize);
          const id = activePtyId;
          if (!id) return;
          if (electron) void resizeElectronPtyToSurface(id);
          else void resizeRemotePtyToSurface(id).catch(() => undefined);
        },
      };

      const wireTerminalInput = (ptyId: string) => {
        term.onData((data) => {
          const usesPromptFallback = agentUsesTerminalPromptFallback(task.agent);
          let submittedPrompt: string | null = null;
          if (usesPromptFallback && !promptTitlePosted) {
            const captured = accumulateTerminalPrompt(promptCaptureBuffer, data);
            promptCaptureBuffer = captured.buffer;
            submittedPrompt = captured.submitted;
          }

          if (!fallbackRunningPosted && terminalInputStartsTurn(task.agent, data)) {
            fallbackRunningPosted = true;
            void (async () => {
              try {
                await api.updateTaskStatus(descriptor.taskId, {
                  status: "running",
                  ...(submittedPrompt ? { prompt: submittedPrompt } : {}),
                });
                if (submittedPrompt) {
                  promptTitlePosted = true;
                }
                await Promise.all([
                  queryClient.invalidateQueries({
                    queryKey: queryKeys.tasks(project.id, project.activeWorktreeId ?? null),
                  }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
                ]);
              } catch {
                fallbackRunningPosted = false;
              }
            })();
          }
          if (ptyApi) {
            ptyApi.write(ptyId, data);
          } else {
            void api.writeRemotePty(ptyId, data);
          }
        });
        term.onResize(({ cols, rows }) => {
          const ptySize = normalizePtySize({ cols, rows });
          if (ptyApi) {
            ptyApi.resize(ptyId, ptySize.cols, ptySize.rows);
          } else {
            void api.resizeRemotePty(ptyId, ptySize.cols, ptySize.rows);
          }
        });
      };

      const wireNewElectronPty = (ptyId: string): boolean => {
        if (!ptyApi) return false;
        activePtyId = ptyId;
        for (const chunk of pendingElectronData.get(ptyId) ?? []) {
          term.write(chunk.data);
        }
        pendingElectronData.delete(ptyId);
        const pendingExit = pendingElectronExit.get(ptyId);
        if (pendingExit) {
          pendingElectronExit.delete(ptyId);
          handlePtyExit(pendingExit.exitCode);
          return false;
        }
        wireTerminalInput(ptyId);
        return true;
      };

      const wireExistingElectronPty = async (ptyId: string): Promise<boolean> => {
        if (!ptyApi) return false;

        electronReplayPtyId = ptyId;
        electronReplayData = [];
        electronReplayExit = pendingElectronExit.get(ptyId) ?? null;
        pendingElectronExit.delete(ptyId);

        activePtyId = ptyId;
        const pendingBeforeReplay = pendingElectronData.get(ptyId) ?? [];
        pendingElectronData.delete(ptyId);
        wireTerminalInput(ptyId);

        void resizeElectronPtyToSurface(ptyId);
        let replay: PtyReplaySnapshot = { data: "", nextSeq: 0 };
        try {
          replay = await ptyApi.replay(ptyId);
        } finally {
          if (electronReplayPtyId === ptyId) {
            electronReplayPtyId = null;
          }
        }
        if (cancelled || activePtyId !== ptyId) return false;

        const replayData = replayDataOrFallback(replay, pendingBeforeReplay);
        if (replayData) term.write(replayData);

        for (const chunk of dataAfterReplay(electronReplayData, replay)) term.write(chunk);
        electronReplayData = [];

        const replayExit = electronReplayExit;
        electronReplayExit = null;
        if (replayExit) {
          handlePtyExit(replayExit.exitCode);
          return false;
        }
        return true;
      };

      const wireRemotePty = async (ptyId: string) => {
        activePtyId = ptyId;
        const { ticket } = await api.createRemotePtyTicket(ptyId);
        const source = new EventSource(
          `/api/remote-pty/${encodeURIComponent(ptyId)}/events?ticket=${encodeURIComponent(ticket)}`
        );
        let replaying = true;
        const pendingLive: string[] = [];
        let exitedBeforeReady = false;
        let streamClosedBeforeReady = false;
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
              else term.write(msg.data);
            }
            if (msg.type === "exit") {
              exitedBeforeReady = true;
              handlePtyExit(msg.exitCode);
            }
            if (msg.type === "error") {
              const message = `remote pty error: ${msg.error ?? "unknown"}`;
              if (replaying) {
                streamClosedBeforeReady = true;
                clearActivePty();
                setStartError(message);
              }
              setLiveStatus(message);
              term.writeln(`\x1b[31m[${message}]\x1b[0m`);
            }
          } catch {
            /* ignore malformed SSE payloads */
          }
        };
        source.onerror = () => {
          const message = "remote pty stream disconnected";
          if (replaying) {
            streamClosedBeforeReady = true;
            clearActivePty();
            setStartError(message);
          }
          setLiveStatus(message);
          term.writeln(`\x1b[31m[${message}]\x1b[0m`);
          markReady(0);
          source.close();
        };
        subscriptions.push(() => source.close());
        const replayBeforeSeq = await Promise.race([
          ready,
          new Promise<number>((resolve) => setTimeout(() => resolve(0), 5000)),
        ]);
        if (exitedBeforeReady || streamClosedBeforeReady) return;
        setLiveStatus("connected to remote runtime");
        term.writeln("\x1b[36m[connected to remote runtime]\x1b[0m");
        await resizeRemotePtyToSurface(ptyId).catch(() => undefined);
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
        const { ptyId } = !electron
          ? await api.createRemotePty({
              taskId: descriptor.taskId,
              cwd: descriptor.cwd || HOSTED_WORKSPACE_ROOT,
              command,
              agent: task.agent,
              cols: ptySize.cols,
              rows: ptySize.rows,
            })
          : useSandbox
            ? await electron.remotePty.spawn({
                taskId: descriptor.taskId,
                cwd: sandboxCwd, // in-container clone path (/workspace/<slug>)
                command,
                cols: ptySize.cols,
                rows: ptySize.rows,
                agent: task.agent,
                dangerouslySkipPermissions: descriptor.dangerouslySkipPermissions,
                missionControlTheme: getTerminalColorScheme(),
                // mcEnv is injected by the main process for sandbox spawns.
              })
            : await electron.pty.spawn({
                taskId: descriptor.taskId,
                cwd: descriptor.cwd,
                command,
                cols: ptySize.cols,
                rows: ptySize.rows,
                agent: task.agent,
                dangerouslySkipPermissions: descriptor.dangerouslySkipPermissions,
                mcEnv: await resolveMcEnv(electron),
                missionControlTheme: getTerminalColorScheme(),
              });
        spawnAt = Date.now();
        spawnedAsResume = isResume;
        if (cancelled) {
          if (ptyApi) await ptyApi.kill(ptyId).catch(() => undefined);
          else await api.killRemotePty(ptyId).catch(() => undefined);
          return;
        }
        if (electron) {
          if (useSandbox) armSpawnAck(ptyId); // surfaces a stuck/never-acked sandbox spawn
          if (wireNewElectronPty(ptyId)) onPtyReady(ptyId);
        } else {
          await wireRemotePty(ptyId);
          if (activePtyId === ptyId) onPtyReady(ptyId);
        }
      };

      const ensurePty = async () => {
        if (cancelled) return;
        if (descriptor.awaitingCreate) return;
        setStartError(null);
        setCloneOffer(null);
        try {
          fitTerminalSurface(term, fit);

          if (descriptor.ptyId) {
            if (useSandbox && electron && !isRemotePtyId(descriptor.ptyId)) {
              await electron.pty.kill(descriptor.ptyId).catch(() => undefined);
            } else {
              // Re-attach to a live PTY: subscribe BEFORE replay so any chunk
              // emitted between the calls is queued, not lost.
              if (electron) {
                await wireExistingElectronPty(descriptor.ptyId);
              } else {
                await wireRemotePty(descriptor.ptyId);
              }
              return;
            }
          }

          // Clone-on-open: a sandbox project whose repo isn't cloned into the
          // container yet gets a clone offer (remote detected from the host repo)
          // instead of an empty terminal. No remote → fall through (empty dir).
          if (useSandbox && electron) {
            let repoPresent = true;
            try {
              await electron.remoteGit.status(sandboxCwd);
            } catch {
              repoPresent = false;
            }
            if (cancelled) return;
            if (!repoPresent) {
              const remote = await electron.sandbox.detectRemote(project.path).catch(() => null);
              if (cancelled) return;
              if (remote) {
                setCloneOffer({ remote, slug: workspaceSlug(sandboxPathName) });
                setLiveStatus("This project isn't in the sandbox yet — clone it to start.");
                return;
              }
            }
          }

          const isResume = isAgentResumeCommand(task.agent, descriptor.startCommand);
          await spawnAndWire(descriptor.startCommand, isResume);
        } catch (err: any) {
          const message = remoteStartErrorMessage(err);
          if (electron) {
            void electron.debugLog.recordSessionTerminalError({
              stage: "terminal-pane-start-failed",
              message,
              taskId: descriptor.taskId,
              agent: task.agent,
              cwd: descriptor.cwd,
              command: descriptor.startCommand,
              details: {
                errorName: err instanceof Error ? err.name : undefined,
                apiStatus: err instanceof ApiError ? err.status : undefined,
              },
            });
          }
          clearActivePty();
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
        for (const off of subscriptions) off();
        stopWatchingColorScheme();
        detachLinks();
        detachFileDrop();
        ro.disconnect();
        fitRef.current = null;
        termSurfaceRef.current = null;
        term.dispose();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [descriptor.taskId, descriptor.awaitingCreate, retryNonce]);

  const confirmClone = useCallback(async () => {
    const electron = getElectron();
    if (!electron || !cloneOffer) return;
    setCloning(true);
    setStartError(null);
    try {
      await electron.remoteGit.clone(cloneOffer.remote, cloneOffer.slug);
      setCloneOffer(null);
      setRetryNonce((n) => n + 1); // re-run: repo now present → the agent spawns
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }, [cloneOffer]);

  return (
    <div
      ref={paneRef}
      style={{
        flex: 1,
        minHeight: 120,
        position: "relative",
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
      {cloneOffer && (
        <div
          role="region"
          aria-label="Clone into sandbox"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            color: "var(--text)",
            background: "var(--accent-faint, var(--accent-dim))",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Not in the sandbox yet — clone {displayCloneRemote(cloneOffer.remote)}?
          </span>
          <Btn variant="primary" size="sm" disabled={cloning} onClick={() => void confirmClone()}>
            {cloning ? "Cloning…" : "Clone into sandbox"}
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
          {isSandboxTerminal && (
            <span
              title="This terminal runs inside the Docker sandbox"
              style={{
                padding: "1px 7px",
                borderRadius: 999,
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--accent)",
                background: "var(--accent-faint, var(--accent-dim))",
                border: "1px solid var(--accent-border)",
                whiteSpace: "nowrap",
                opacity: 0.85,
                marginRight: 6,
              }}
            >
              sandbox
            </span>
          )}
          <TerminalZoomControls
            level={zoomLevel}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
          <HotkeyTooltip action="session.clone" label="Clone session">
            <Btn
              variant="ghost"
              size="sm"
              icon="copy"
              onClick={requestSessionClone}
              aria-label="Clone session"
              style={{ width: 34, padding: 0 }}
            />
          </HotkeyTooltip>
          {onToggleExpanded && (
            <HotkeyTooltip
              action="terminal.expandToggle"
              label={expanded ? "Shrink session panel" : "Expand session panel"}
            >
              <Btn
                variant="ghost"
                size="sm"
                icon={expanded ? "minimize" : "maximize"}
                onClick={onToggleExpanded}
                aria-label={expanded ? "Shrink session panel" : "Expand session panel"}
                aria-pressed={expanded}
                style={{ width: 34, padding: 0 }}
              />
            </HotkeyTooltip>
          )}
          {onHide && (
            <HotkeyTooltip action="terminal.close" label="Hide session panel">
              <Btn
                variant="ghost"
                size="sm"
                icon="x"
                onClick={onHide}
                aria-label="Hide session panel"
                style={{ width: 34, padding: 0 }}
              />
            </HotkeyTooltip>
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
