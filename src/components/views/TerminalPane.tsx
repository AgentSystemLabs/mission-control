import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenuItem";
import { Modal } from "~/components/ui/Modal";
import { TextField } from "~/components/ui/TextField";
import { EscTooltip, HotkeyTooltip, Tooltip } from "~/components/ui/Tooltip";
import { Z_INDEX } from "~/lib/z-index";
import {
  AGENT_META,
  DUPLICATE_ACTIVE_SESSION_EVENT,
  STATUS_META,
} from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { takePendingInitialInput } from "~/lib/voice-session-prompts";
import {
  VOICE_PASTE_TO_FOCUSED_SESSION_EVENT,
  type VoicePasteToFocusedSessionDetail,
} from "~/lib/voice-events";
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
  getCurrentTerminalFont,
  getTerminalColorScheme,
  watchTerminalColorScheme,
} from "~/lib/terminal-options";
import {
  useTerminalZoom,
  useTerminalPaneZoomShortcuts,
  useTerminalPaneWheelZoom,
} from "~/lib/use-terminal-zoom";
import { useHotkey } from "~/lib/use-hotkey";
import { SandboxCloneOfferBanner } from "~/components/views/SandboxCloneOfferBanner";
import { TerminalZoomControls } from "~/components/views/TerminalZoomControls";
import { ApiError, api, resolveApiToken } from "~/lib/api";
import {
  agentUsesPersistedSession,
  buildFreshAgentLaunchCommand,
  isAgentResumeCommand,
  newSessionId,
  shouldInjectInitialInput,
} from "~/lib/agent-command";
import { getDefaultModelForAgent } from "~/lib/default-model-store";
import { terminalInputStartsTurn, agentUsesTerminalPromptFallback } from "~/lib/task-status-sync";
import { accumulateTerminalPrompt } from "~/lib/terminal-prompt-capture";
import { prefetchTerminalModules } from "~/lib/prefetch-terminal-modules";
import { createTerminalGpuLease } from "~/lib/terminal-webgl";
import { acquireSpawnSlot, SPAWN_SETTLE_MS } from "~/lib/pty-spawn-queue";
import { acquireSurfaceBuildTurn } from "~/lib/terminal-build-queue";
import {
  terminalSurfaceCache,
  type PaneTerminalSurface,
} from "~/lib/terminal-surface-cache";
import { attachTerminalLinks } from "~/lib/terminal-links";
import {
  createSettledFit,
  createSettledPtyResize,
  resizePtyToTerminal,
} from "~/lib/terminal-resize";
import {
  appendBoundedSequencedData,
  dataAfterReplay,
  replayDataOrFallback,
  sequencedPtyData,
  type PtyReplaySnapshot,
  type SequencedPtyData,
} from "~/lib/terminal-replay";
import { queryKeys, useTasks } from "~/queries";
import { terminalSurfaceIdForProject, useTerminals } from "~/lib/terminal-store";
import type { Project, Task } from "~/db/schema";
import { normalizePtySize } from "~/shared/pty-size";
import { sandboxWorkspacePath, workspaceSlug } from "~/shared/sandbox-workspace";
import { AGENT_REGISTRY } from "~/shared/agents";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { toast } from "sonner";

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
  /** Restored from localStorage; spawn waits until the task is revalidated. */
  pendingValidation?: boolean;
};

/** The session pane's cached xterm surface; carries the sandbox flag so the
 *  "sandbox" badge can be restored on reattach without re-detecting the runtime. */
interface SessionTerminalSurface extends PaneTerminalSurface {
  useSandbox: boolean;
}

// Header width (px) below which the secondary controls (rename, zoom, clone)
// collapse into the "…" menu; below the tiny threshold the title/status block
// is hidden too and surfaces at the top of that menu instead; below micro even
// the close button folds into the menu (grid cells can shrink to MIN_CELL_PX).
const HEADER_COMPACT_MAX = 380;
const HEADER_TINY_MAX = 210;
const HEADER_MICRO_MAX = 120;

/** "…" dropdown holding the header controls that don't fit a narrow pane.
 *  In tiny mode it also carries the (hidden) session title and status. */
function HeaderMoreMenu({
  title,
  statusLabel,
  statusColor,
  showTitle,
  showSandboxBadge,
  expanded,
  onToggleExpanded,
  onHide,
  onRename,
  onClone,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
}: {
  title: string;
  statusLabel: string;
  statusColor: string;
  /** Tiny header: the pane title is hidden, so show it at the top of the menu. */
  showTitle: boolean;
  showSandboxBadge: boolean;
  expanded: boolean;
  /** Present only when the expand control was also collapsed into the menu. */
  onToggleExpanded?: () => void;
  /** Present only when the close control was also collapsed into the menu. */
  onHide?: () => void;
  onRename: () => void;
  onClone: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <Tooltip content="Session actions">
        <Btn
          ref={anchorRef}
          variant="ghost"
          size="sm"
          icon="more"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Session actions for ${title}`}
          style={{ width: 34, padding: 0 }}
        />
      </Tooltip>
      {open &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label={`Session actions for ${title}`}
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              right: menuRect.right,
              minWidth: 190,
              maxWidth: 260,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            {showTitle && (
              <>
                <div style={{ padding: "7px 8px 5px", fontFamily: "var(--mono)", minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ color: statusColor }}>{statusLabel}</span>
                    {showSandboxBadge && (
                      <span style={{ color: "var(--accent)", opacity: 0.85 }}>sandbox</span>
                    )}
                  </div>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem icon="pencil" onClick={() => pick(onRename)}>
              Rename session
            </DropdownMenuItem>
            <DropdownMenuItem icon="zoom-out" disabled={!canZoomOut} onClick={onZoomOut}>
              Zoom out
            </DropdownMenuItem>
            <DropdownMenuItem icon="zoom-in" disabled={!canZoomIn} onClick={onZoomIn}>
              Zoom in
            </DropdownMenuItem>
            <DropdownMenuItem icon="copy" onClick={() => pick(onClone)}>
              Clone session
            </DropdownMenuItem>
            {onToggleExpanded && (
              <DropdownMenuItem
                icon={expanded ? "minimize" : "maximize"}
                onClick={() => pick(onToggleExpanded)}
              >
                {expanded ? "Shrink panel" : "Expand panel"}
              </DropdownMenuItem>
            )}
            {onHide && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon="x" danger onClick={() => pick(onHide)}>
                  Hide session panel
                </DropdownMenuItem>
              </>
            )}
          </CardFrame>,
          document.body,
        )}
    </>
  );
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
  onHeaderPointerDown,
  headerGrabbing = false,
}: {
  project: Project & { activeWorktreeId?: string | null; activeRuntimeScopeId?: string | null };
  task: Task;
  onHide?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  isLast: boolean;
  descriptor: TerminalDescriptor;
  onPtyReady: (ptyId: string | null) => void;
  /** When set, the header bar becomes a drag handle (used by the session grid). */
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  headerGrabbing?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const termSurfaceRef = useRef<{ setFontSize: (fontSize: number) => void } | null>(null);
  const renameFormId = useId();
  const queryClient = useQueryClient();
  const terminals = useTerminals();
  const [liveStatus, setLiveStatus] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [isSandboxTerminal, setIsSandboxTerminal] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const savingTitleRef = useRef(false);
  // When a sandbox project's repo isn't cloned into the container yet, offer to
  // clone it (remote detected from the host project) instead of opening empty.
  const [cloneOffer, setCloneOffer] = useState<{ remote: string; slug: string } | null>(null);
  const [cloning, setCloning] = useState(false);
  const {
    level: zoomLevel,
    fontSize: terminalFontSize,
    zoomBy,
    zoomIn,
    zoomOut,
    canZoomIn,
    canZoomOut,
  } = useTerminalZoom(descriptor.taskId);
  useTerminalPaneZoomShortcuts(paneRef, zoomIn, zoomOut);
  useTerminalPaneWheelZoom(paneRef, zoomBy);

  // Track the header's width so narrow grid cells can collapse controls into
  // the "…" menu (compact) and drop the title entirely (tiny).
  const [headerWidth, setHeaderWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setHeaderWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compactHeader = headerWidth !== null && headerWidth < HEADER_COMPACT_MAX;
  const tinyHeader = headerWidth !== null && headerWidth < HEADER_TINY_MAX;
  const microHeader = headerWidth !== null && headerWidth < HEADER_MICRO_MAX;

  const activeRuntimeScopeId = project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID;
  const { data: liveTasks } = useTasks(
    project.id,
    project.activeWorktreeId ?? null,
    activeRuntimeScopeId,
  );
  const liveTask = liveTasks?.find((t) => t.id === task.id) ?? task;
  const meta = AGENT_META[liveTask.agent];
  const statusMeta = STATUS_META[liveTask.status];
  const tasksKey = queryKeys.tasks(
    project.id,
    project.activeWorktreeId ?? null,
    activeRuntimeScopeId,
  );

  const requestSessionClone = () => {
    if (typeof window === "undefined") return;
    // Carry this pane's own session id so the handler clones (and, in grid view,
    // positions the clone next to) the session whose button was clicked — not
    // whatever session happens to be active in the current scope.
    window.dispatchEvent(
      new CustomEvent(DUPLICATE_ACTIVE_SESSION_EVENT, { detail: { taskId: task.id } }),
    );
  };

  useEffect(() => {
    if (!renameOpen) setTitleDraft(liveTask.title);
  }, [renameOpen, liveTask.title]);

  const openRenameDialog = () => {
    setTitleDraft(liveTask.title);
    setRenameOpen(true);
  };

  const closeRenameDialog = () => {
    if (savingTitleRef.current) return;
    setTitleDraft(liveTask.title);
    setRenameOpen(false);
  };

  const commitTitleEdit = async () => {
    if (savingTitleRef.current) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) return;
    if (nextTitle === liveTask.title) {
      setRenameOpen(false);
      return;
    }

    savingTitleRef.current = true;
    setSavingTitle(true);
    await queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
    const previousTask = previousTasks?.find((t) => t.id === liveTask.id) ?? liveTask;
    const optimisticTask = {
      ...liveTask,
      title: nextTitle,
      titleManuallySet: true,
      updatedAt: Date.now(),
    };
    queryClient.setQueryData<Task[]>(tasksKey, (current) =>
      (current ?? []).map((t) => (t.id === liveTask.id ? optimisticTask : t)),
    );
    terminals.syncTask(optimisticTask);

    try {
      const saved = await api.updateTask(liveTask.id, { title: nextTitle });
      queryClient.setQueryData<Task[]>(tasksKey, (current) =>
        (current ?? []).map((t) => (t.id === liveTask.id ? saved.task : t)),
      );
      terminals.syncTask(saved.task);
      setRenameOpen(false);
      void queryClient.invalidateQueries({ queryKey: tasksKey });
    } catch (e: unknown) {
      if (previousTasks) queryClient.setQueryData<Task[]>(tasksKey, previousTasks);
      terminals.syncTask(previousTask);
      toast.error(e instanceof Error ? e.message : "Could not rename session");
    } finally {
      savingTitleRef.current = false;
      setSavingTitle(false);
    }
  };
  const canSaveTitle = titleDraft.trim().length > 0 && !savingTitle;
  useHotkey("dialog.submit", () => void commitTitleEdit(), {
    enabled: renameOpen && canSaveTitle,
  });

  useEffect(() => {
    termSurfaceRef.current?.setFontSize(terminalFontSize);
  }, [terminalFontSize]);

  useEffect(() => {
    const cache = terminalSurfaceCache;
    const surfaceId = terminalSurfaceIdForProject(project, descriptor.taskId);
    // awaitingCreate (task row not yet persisted), pendingValidation (restored
    // session not yet revalidated) and the retry nonce all mean "build fresh";
    // a plain remount (navigating back to this session) keeps the same buildKey
    // and reattaches the existing surface instantly — no replay.
    const buildKey = `${descriptor.awaitingCreate ? 1 : 0} ${descriptor.pendingValidation ? 1 : 0} ${retryNonce}`;
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
      // Refit only after the resize settles — a live refit clears the WebGL
      // canvas on every cell-boundary crossing, strobing the whole grid.
      const settledFit = createSettledFit(() => surface.fit());
      const ro = new ResizeObserver(() => settledFit.schedule());
      ro.observe(container);
      surface.fit();
      // GPU rendering only while visible — parked surfaces release the context.
      surface.gpu?.attach();
      if (surface.ptyId) onPtyReady(surface.ptyId);
      return () => {
        ro.disconnect();
        settledFit.cancel();
        surface.gpu?.detach();
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

    // Held while this pane does its heavy renderer work (Terminal + open() +
    // GPU attach); released in the .finally below so error/cancel paths can't
    // strand the turn. See terminal-build-queue.
    let releaseBuildTurn: (() => void) | null = null;

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

      // A grid mounts every pane in one commit; building all their xterm
      // surfaces in one task blocks the route transition's first paint. Take
      // per-frame turns instead so the page shows instantly and cells fill in.
      releaseBuildTurn = await acquireSurfaceBuildTurn();
      if (cancelled || !containerRef.current) return;

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
      const gpu = createTerminalGpuLease(term);

      const surface: SessionTerminalSurface = {
        id: surfaceId,
        el,
        buildKey,
        useSandbox,
        ptyId: null,
        destroyed: false,
        gpu,
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
      // Coalesce interactive-resize storms (grid drag, wheel zoom) into one
      // agent SIGWINCH after the drag settles; targets the then-active pty.
      const settledPtyResize = createSettledPtyResize((cols, rows) => {
        const id = activePtyId;
        if (id && ptyApi) ptyApi.resize(id, cols, rows);
      });
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
      // Held while a freshly spawned local agent is still booting; released on
      // its first output (or a settle timeout) so grid loads start a couple of
      // agents at a time instead of all at once. See pty-spawn-queue.
      let releaseSpawnSlot: (() => void) | null = null;
      const releaseSpawnHold = () => {
        releaseSpawnSlot?.();
        releaseSpawnSlot = null;
      };
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
        // A theme with a bundled face (ember → JetBrains Mono) swaps the
        // terminal font live; the glyph box changes, so refit to reflow.
        const font = getCurrentTerminalFont();
        if (term.options.fontFamily !== font) {
          term.options.fontFamily = font;
          fitTerminalSurface(term, fit);
        }
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

      const onVoicePaste = (event: Event) => {
        const detail = (event as CustomEvent<VoicePasteToFocusedSessionDetail>).detail;
        if (!detail?.text || !activePtyId) return;
        const activeEl = document.activeElement;
        if (!(activeEl instanceof HTMLElement) || !host.contains(activeEl)) return;
        term.paste(detail.text);
        term.focus();
        detail.handled = true;
      };
      window.addEventListener(VOICE_PASTE_TO_FOCUSED_SESSION_EVENT, onVoicePaste);
      subscriptions.push(() =>
        window.removeEventListener(VOICE_PASTE_TO_FOCUSED_SESSION_EVENT, onVoicePaste),
      );

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
              { model: getDefaultModelForAgent(task.agent) },
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
              releaseSpawnHold();
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
              releaseSpawnHold();
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
          // Wheel-zoom fires this per tick; the refit's onResize event lands in
          // the settled debouncer, so the agent repaints once per zoom gesture.
          applyTerminalFontSize(term, fit, nextFontSize);
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
        term.onResize((size) => settledPtyResize.schedule(size));
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
        // Local agent launches are throttled: the slot is held until the agent's
        // first output (or SPAWN_SETTLE_MS) so a grid full of sessions boots a
        // couple of CLIs at a time instead of stampeding the whole machine.
        // Sandbox spawns run remotely and skip the queue.
        if (!useSandbox) {
          releaseSpawnHold();
          releaseSpawnSlot = await acquireSpawnSlot();
          if (surface.destroyed) {
            releaseSpawnHold();
            return;
          }
        }
        const ptySize = normalizePtySize({ cols: term.cols, rows: term.rows });
        const initialInput = !useSandbox && shouldInjectInitialInput(task.agent, isResume)
          ? takePendingInitialInput(descriptor.taskId)
          : undefined;
        let spawnResult: { ptyId: string };
        try {
          spawnResult = useSandbox
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
                // Voice-seeded starting prompt, consumed once on the first spawn so
                // reloads/re-spawns never re-inject it. Undefined for normal sessions.
                initialInput,
              });
        } catch (err) {
          releaseSpawnHold();
          throw err;
        }
        const { ptyId } = spawnResult;
        // Fallback release: an agent that boots silently must not pin its queue
        // slot forever. First output releases earlier via releaseSpawnHold().
        if (!useSandbox) window.setTimeout(releaseSpawnHold, SPAWN_SETTLE_MS);
        spawnAt = Date.now();
        spawnedAsResume = isResume;
        if (surface.destroyed) {
          releaseSpawnHold();
          if (ptyApi) await ptyApi.kill(ptyId).catch(() => undefined);
          return;
        }
        if (useSandbox) armSpawnAck(ptyId); // surfaces a stuck/never-acked sandbox spawn
        if (wireNewElectronPty(ptyId)) onPtyReady(ptyId);
      };

      const ensurePty = async () => {
        if (surface.destroyed) return;
        if (descriptor.awaitingCreate) return;
        // Restored session not yet revalidated — the store either clears the
        // gate (task alive; effect re-runs via deps) or closes the session.
        if (descriptor.pendingValidation) return;
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

          // Local pty ids are lost on a renderer reload, but the agent
          // processes survive in the main process. Reattach to a live PTY for
          // this task instead of spawning a duplicate — agents that pin a
          // session id die with "Session ID ... is already in use" when a
          // second copy launches.
          if (!useSandbox && electron) {
            let livePtyId: string | null = null;
            try {
              livePtyId = (await electron.pty.findByTask(descriptor.taskId)).ptyId;
            } catch {
              /* older main process without findByTask — fall through to spawn */
            }
            if (surface.destroyed) return;
            if (livePtyId && livePtyId !== descriptor.ptyId) {
              const attached = await wireExistingElectronPty(livePtyId);
              if (attached) {
                onPtyReady(livePtyId);
                return;
              }
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
          clearActivePty();
          setStartError(message);
          setLiveStatus(message);
          term.writeln(`\x1b[31m[failed to start pty: ${message}]\x1b[0m`);
        }
      };

      surface.teardown = () => {
        cancelAnimationFrame(rafHandle);
        clearSpawnAck();
        settledPtyResize.cancel();
        releaseSpawnHold();
        for (const off of subscriptions) off();
        stopWatchingColorScheme();
        detachLinks();
        detachFileDrop();
        fitRef.current = null;
        gpu.dispose();
        term.dispose();
      };

      cache.set(surface);
      term.focus();
      rafHandle = window.requestAnimationFrame(() => ensurePty());
      detachMount = bindMount(surface);
    })().finally(() => releaseBuildTurn?.());

    return () => {
      cancelled = true;
      detachMount?.();
    };
  }, [descriptor.taskId, descriptor.awaitingCreate, descriptor.pendingValidation, retryNonce]);

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
    <>
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
        ref={headerRef}
        data-session-header
        onPointerDown={onHeaderPointerDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          borderBottom: "1px solid var(--border)",
          transition: "background 140ms ease, border-color 140ms ease",
          flexShrink: 0,
          userSelect: "none",
          cursor: onHeaderPointerDown ? (headerGrabbing ? "grabbing" : "grab") : undefined,
          touchAction: onHeaderPointerDown ? "none" : undefined,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {!tinyHeader && (
            <>
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
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {isSandboxTerminal && !tinyHeader && (
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
          {compactHeader ? (
            <HeaderMoreMenu
              title={liveTask.title}
              statusLabel={statusMeta.label}
              statusColor={statusMeta.color}
              showTitle={tinyHeader}
              showSandboxBadge={isSandboxTerminal}
              expanded={expanded}
              onToggleExpanded={tinyHeader ? onToggleExpanded : undefined}
              onHide={microHeader ? onHide : undefined}
              onRename={openRenameDialog}
              onClone={requestSessionClone}
              canZoomIn={canZoomIn}
              canZoomOut={canZoomOut}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
            />
          ) : (
            <>
              <Tooltip content="Rename session">
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="pencil"
                  onClick={openRenameDialog}
                  aria-label={`Rename session ${liveTask.title}`}
                  style={{ width: 34, padding: 0 }}
                />
              </Tooltip>
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
            </>
          )}
          {onToggleExpanded && !tinyHeader && (
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
          {onHide && !microHeader && (
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
      <Modal
        open={renameOpen}
        onClose={closeRenameDialog}
        title="Rename session"
        width={420}
        footer={
          <>
            <EscTooltip label="Cancel">
              <Btn variant="ghost" onClick={closeRenameDialog} disabled={savingTitle}>
                Cancel
              </Btn>
            </EscTooltip>
            <HotkeyTooltip action="dialog.submit" disabled={!canSaveTitle}>
              <Btn
                variant="primary"
                icon="check"
                type="submit"
                form={renameFormId}
                disabled={!canSaveTitle}
              >
                Rename
              </Btn>
            </HotkeyTooltip>
          </>
        }
      >
        <form
          id={renameFormId}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSaveTitle) return;
            void commitTitleEdit();
          }}
        >
          <TextField
            label="Session name"
            value={titleDraft}
            onChange={setTitleDraft}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            required
          />
        </form>
      </Modal>
    </>
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
