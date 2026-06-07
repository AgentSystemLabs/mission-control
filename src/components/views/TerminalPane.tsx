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
  terminalExitTaskStatus,
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
import { SandboxCloneOfferBanner } from "~/components/views/SandboxCloneOfferBanner";
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
import {
  terminalSurfaceCache,
  type PaneTerminalSurface,
} from "~/lib/terminal-surface-cache";
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
import { sandboxWorkspacePath, workspaceSlug } from "~/shared/sandbox-workspace";
import { AGENT_REGISTRY } from "~/shared/agents";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

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

export type TerminalDescriptor = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  dangerouslySkipPermissions: boolean;
  cwd: string;
  awaitingCreate?: boolean;
};

/** The session pane's cached xterm surface; carries the sandbox flag so the
 *  "sandbox" badge can be restored on reattach without re-detecting the runtime. */
interface SessionTerminalSurface extends PaneTerminalSurface {
  useSandbox: boolean;
}

export function TerminalPane({
  project,
  task,
  onHide,
  expanded = false,
  onToggleExpanded,
  isLast,
  descriptor,
  onPtyReady,
}: {
  project: Project & { activeWorktreeId?: string | null; activeRuntimeScopeId?: string | null };
  task: Task;
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

  const activeRuntimeScopeId = project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID;
  const { data: liveTasks } = useTasks(
    project.id,
    project.activeWorktreeId ?? null,
    activeRuntimeScopeId,
  );
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
    const cache = terminalSurfaceCache;
    const surfaceId = `${descriptor.taskId}:${project.activeWorktreeId ?? MAIN_WORKTREE_ID}:${project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}`;
    // awaitingCreate (task row not yet persisted) and the retry nonce both mean
    // "build fresh"; a plain remount (navigating back to this session) keeps the
    // same buildKey and reattaches the existing surface instantly — no replay.
    const buildKey = `${descriptor.awaitingCreate ? 1 : 0} ${retryNonce}`;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let detachMount: (() => void) | undefined;

    // Bind THIS mount to a (new or reattached) surface. The returned cleanup
    // PARKS the surface (offscreen, still subscribed) instead of disposing it, so
    // leaving and returning to this session is a DOM move rather than a teardown +
    // scrollback replay.
    const bindMount = (surface: SessionTerminalSurface) => {
      termSurfaceRef.current = surface.controls;
      setIsSandboxTerminal(surface.useSandbox);
      surface.controls.setFontSize(terminalFontSize);
      const ro = new ResizeObserver(() => surface.fit());
      ro.observe(container);
      surface.fit();
      if (surface.ptyId) onPtyReady(surface.ptyId);
      return () => {
        ro.disconnect();
        if (termSurfaceRef.current === surface.controls) termSurfaceRef.current = null;
        cache.park(surface.id);
      };
    };

    const existing = cache.get(surfaceId) as SessionTerminalSurface | null;
    if (existing && existing.buildKey === buildKey) {
      container.appendChild(existing.el);
      const detach = bindMount(existing);
      return () => detach();
    }
    // A stale build (Retry / task just persisted) must not reattach the old one.
    if (existing) cache.destroy(surfaceId);

    const electron = getElectron();

    void (async () => {
      const { Terminal, FitAddon } = await prefetchTerminalModules();
      if (cancelled || !containerRef.current) return;

      // Sandbox terminals talk to the remote agent via `remotePty`; host
      // terminals use the local PTY.
      // `remotePty` mirrors `pty`'s method shape, so only spawn differs below.
      // Read the runtime setting fresh at terminal start; default to host.
      const useSandbox = !!electron && (await isDockerSandboxRuntime(electron));
      if (cancelled || !containerRef.current) return;
      const ptyApi = electron ? (useSandbox ? electron.remotePty : electron.pty) : null;
      const sandboxPathName = project.path.split("/").filter(Boolean).pop() ?? project.name;
      const sandboxCwd = sandboxWorkspacePath(sandboxPathName);

      const cursorColor = meta?.color;
      // xterm renders into a surface-owned element so it survives unmounts and is
      // re-parented between this container and the offscreen holder. Attach it to
      // the live container BEFORE open() so xterm measures real dimensions.
      const el = document.createElement("div");
      el.style.width = "100%";
      el.style.height = "100%";
      container.appendChild(el);
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
      term.open(el);

      const surface: SessionTerminalSurface = {
        id: surfaceId,
        el,
        buildKey,
        useSandbox,
        ptyId: null,
        destroyed: false,
        controls: {
          focus: () => term.focus(),
          clear: () => term.clear(),
          setFontSize: () => undefined,
        },
        fit: () => fitTerminalSurface(term, fit),
        teardown: () => undefined,
      };

      const host = el;
      const subscriptions: Array<() => void> = [];
      let rafHandle = 0;
      let activePtyId: string | null = null;
      // The PTY subscription stays wired while parked; mirror the active pty onto
      // the surface so reattach + the session list's running state stay correct.
      const setActivePty = (id: string | null) => {
        activePtyId = id;
        surface.ptyId = id;
      };
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
          if (surface.destroyed || activePtyId !== ptyId) return;
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
        setActivePty(null);
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
        if (surface.destroyed || consumeIntentionalSessionClose(descriptor.taskId)) {
          return;
        }
        clearActivePty();
        const status = terminalExitTaskStatus(exitCode);
        const code = exitCode ?? "unknown";
        const message =
          status === "finished"
            ? `Session finished (code=${code}).`
            : `Session terminated (code=${code}).`;
        setLiveStatus(message);
        term.writeln("");
        term.writeln(`\x1b[2m[${message}]\x1b[0m`);
        void (async () => {
          try {
            await api.updateTaskStatus(descriptor.taskId, { status });
          } catch {
            /* best effort */
          }
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: queryKeys.tasks(
                project.id,
                project.activeWorktreeId ?? null,
                activeRuntimeScopeId,
              ),
            }),
            queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
          ]);
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

      surface.controls = {
        focus: () => term.focus(),
        clear: () => term.clear(),
        setFontSize: (nextFontSize) => {
          applyTerminalFontSize(term, fit, nextFontSize);
          const id = activePtyId;
          if (!id) return;
          void resizeElectronPtyToSurface(id);
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
                    queryKey: queryKeys.tasks(
                      project.id,
                      project.activeWorktreeId ?? null,
                      activeRuntimeScopeId,
                    ),
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
          }
        });
        term.onResize(({ cols, rows }) => {
          const ptySize = normalizePtySize({ cols, rows });
          if (ptyApi) {
            ptyApi.resize(ptyId, ptySize.cols, ptySize.rows);
          }
        });
      };

      const wireNewElectronPty = (ptyId: string): boolean => {
        if (!ptyApi) return false;
        setActivePty(ptyId);
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

        setActivePty(ptyId);
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
        if (surface.destroyed || activePtyId !== ptyId) return false;
        if (replay.nextSeq === 0) {
          clearActivePty();
          return false;
        }

        const replayData = replayDataOrFallback(replay, pendingBeforeReplay);
        if (replayData) term.write(replayData);

        for (const chunk of dataAfterReplay(electronReplayData, replay)) term.write(chunk);
        electronReplayData = [];

        const replayExit = electronReplayExit;
        electronReplayExit = null;
        if (replayExit) {
          handlePtyExit(replayExit.exitCode);
          return true;
        }
        return true;
      };

      const spawnAndWire = async (command: string, isResume: boolean) => {
        if (!electron) return;
        const ptySize = normalizePtySize({ cols: term.cols, rows: term.rows });
        const { ptyId } = useSandbox
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
        if (surface.destroyed) {
          if (ptyApi) await ptyApi.kill(ptyId).catch(() => undefined);
          return;
        }
        if (useSandbox) armSpawnAck(ptyId); // surfaces a stuck/never-acked sandbox spawn
        if (wireNewElectronPty(ptyId)) onPtyReady(ptyId);
      };

      const ensurePty = async () => {
        if (surface.destroyed) return;
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
              let attached = false;
              if (electron) {
                attached = await wireExistingElectronPty(descriptor.ptyId);
              }
              if (attached) return;
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
            if (surface.destroyed) return;
            if (!repoPresent) {
              const remote = await electron.sandbox.detectRemote(project.path).catch(() => null);
              if (surface.destroyed) return;
              if (remote) {
                // Auto-clone on launch: the repo isn't in the sandbox yet, so pull
                // it in before spawning the agent. The manager provisions git auth
                // (copy-host SSH keys) first, so private repos work. On failure we
                // fall back to the manual banner so the user can retry/see why.
                const slug = workspaceSlug(sandboxPathName);
                setCloneOffer({ remote, slug });
                setCloning(true);
                setLiveStatus("Cloning the project into the sandbox…");
                try {
                  await electron.remoteGit.clone(remote, slug);
                  if (surface.destroyed) return;
                  setCloneOffer(null);
                  setCloning(false);
                  // Repo is present now — fall through to spawn the agent.
                } catch (cloneErr) {
                  if (surface.destroyed) return;
                  setCloning(false);
                  setStartError(cloneErr instanceof Error ? cloneErr.message : String(cloneErr));
                  setLiveStatus("Couldn't clone automatically — use the banner to retry.");
                  return;
                }
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

      surface.teardown = () => {
        cancelAnimationFrame(rafHandle);
        clearSpawnAck();
        for (const off of subscriptions) off();
        stopWatchingColorScheme();
        detachLinks();
        detachFileDrop();
        fitRef.current = null;
        term.dispose();
      };

      cache.set(surface);
      term.focus();
      rafHandle = window.requestAnimationFrame(() => ensurePty());
      detachMount = bindMount(surface);
    })();

    return () => {
      cancelled = true;
      detachMount?.();
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
        <SandboxCloneOfferBanner
          remote={cloneOffer.remote}
          cloning={cloning}
          onConfirm={() => void confirmClone()}
        />
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
              title="This terminal runs inside the selected sandbox"
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
