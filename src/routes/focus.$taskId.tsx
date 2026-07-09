import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { StatusDot } from "~/components/ui/StatusDot";
import { HotkeyTooltip, Tooltip } from "~/components/ui/Tooltip";
import { TerminalPane } from "~/components/views/TerminalPane";
import { FocusSessionBar } from "~/components/views/FocusSessionBar";
import { ScreenshotThumbnail } from "~/components/views/ScreenshotThumbnail";
import { applyQuestionServerEvent } from "~/lib/agent-question-store";
import { STATUS_META } from "~/lib/design-meta";
import { getElectron, isElectron } from "~/lib/electron";
import { exitFocusSession, switchFocusSession } from "~/lib/focus-session";
import {
  screenshotCaptureErrorMessage,
  screenshotFromResult,
  screenshotSupported as isScreenshotSupported,
} from "~/lib/screenshot";
import { playScreenshotCapture } from "~/lib/screenshot-sound";
import {
  orderSessions,
  reconcileFocusOrder,
  type SessionSnapshot,
} from "~/lib/focus-session-order";
import { scopeKeyForProject, type ScopedProject } from "~/lib/scoped-project";
import { useTerminals, type OpenTerminal } from "~/lib/terminal-store";
import { useHotkey } from "~/lib/use-hotkey";
import { useServerEvents } from "~/lib/use-events";
import { queryKeys, useTasks } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { worktreeScopeKey } from "~/shared/worktrees";
import type { Task } from "~/db/schema";

export const Route = createFileRoute("/focus/$taskId")({
  component: FocusSessionPage,
});

const FOCUS_BAR_OPEN_KEY = "mc.focusMode.sessionBarOpen";

function loadBarOpenPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(FOCUS_BAR_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveBarOpenPref(open: boolean): void {
  try {
    window.localStorage.setItem(FOCUS_BAR_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* quota / privacy mode — preference just won't persist */
  }
}

// Focused Session Mode: the Shell strips all app chrome on /focus/* and the
// Electron window is a small always-on-top floating card (see
// electron/focus-mode.ts), so this route IS the whole visible window — a thin
// draggable header, an optional session bar, and one live TerminalPane. The
// pane's surface comes from the shared terminal-surface-cache, so switching
// sessions swaps the terminal instantly, without a scrollback replay, and the
// floating window is never recreated.
function FocusSessionPage() {
  const { taskId } = Route.useParams();
  const router = useRouter();
  const terminals = useTerminals();
  const queryClient = useQueryClient();
  const syncTask = terminals.syncTask;

  const session = terminals.sessions.find((s) => s.taskId === taskId) ?? null;
  const hasSession = !!session;
  const currentProjectId = session?.project.id ?? null;

  // The switchable set backing the session bar: live sessions belonging to the
  // SAME project as the focused one (skip provisional optimistic-create rows and
  // archived ones, which get reaped). Sessions from other projects never appear.
  const switchable = useMemo(
    () =>
      currentProjectId
        ? terminals.sessions.filter(
            (s) =>
              s.project.id === currentProjectId &&
              !s.task.archived &&
              !s.awaitingCreate,
          )
        : [],
    [terminals.sessions, currentProjectId],
  );

  // Latest grid state, read through a ref so the exit callback (which feeds the
  // stable close-intent + hotkey subscriptions) doesn't churn on every store
  // update.
  const gridStateRef = useRef({
    gridView: terminals.gridView,
    focusGridSession: terminals.focusGridSession,
  });
  gridStateRef.current = {
    gridView: terminals.gridView,
    focusGridSession: terminals.focusGridSession,
  };

  const exit = useCallback(() => {
    // Grid view marks the "active" session by which cell holds the caret + accent
    // ring (its `focusedTaskId`), NOT by the stored active-session that drives the
    // panel view (synced by the effect below). So on the way out, ask the grid to
    // spotlight the tab we're leaving on: the request lives in the terminal store,
    // survives the route swap, and the grid's spotlight effect consumes it on
    // mount — its retry poll re-asserts focus + ring across the progressive cell
    // remount, which the single-shot pending-refocus silently misses.
    const { gridView, focusGridSession } = gridStateRef.current;
    if (gridView) focusGridSession(taskId);
    void exitFocusSession(router, taskId);
  }, [router, taskId]);

  // Keep the panel view's active session in step with the focused tab. Every way
  // the focused session changes here — bar click, cycle hotkey — lands on a new
  // `session`; recording it as active for its scope means exiting focus mode
  // restores the panel view onto the session that was on screen while floating,
  // not the one focus mode was originally opened from. (Grid view is handled by
  // the spotlight request in `exit` above.) The project route is unmounted while
  // floating, so this only takes visible effect on exit.
  const setActiveSession = terminals.setActiveSession;
  useEffect(() => {
    if (!session) return;
    setActiveSession(session.project, session.taskId);
  }, [session, setActiveSession]);

  // The session disappearing from the store (archived, killed, failed
  // revalidation — from any surface) is the one signal to leave focus mode.
  useEffect(() => {
    if (session) return;
    exit();
  }, [session, exit]);

  // Smart ordering + unread badges for the session bar. The entered session
  // leads on open (handled in the initial fold); after that only status
  // transitions reorder — switching tabs just highlights in place.
  const { orderedSessions, unread } = useFocusSessionOrder(switchable, taskId);

  // Keep every open session's task row live while focused. The project route —
  // which normally drives syncTask from the tasks query — is unmounted here, so
  // without this the bar's background tabs would show stale status/titles. One
  // hidden subscription per distinct (project, worktree, scope) among the open
  // sessions feeds syncTask; the SSE handler below invalidates all of them.
  const distinctScopes = useMemo(() => {
    const byScope = new Map<string, ScopedProject>();
    for (const s of switchable) {
      const key = scopeKeyForProject(s.project);
      if (!byScope.has(key)) byScope.set(key, s.project);
    }
    return [...byScope.values()];
  }, [switchable]);
  const distinctScopesRef = useRef(distinctScopes);
  distinctScopesRef.current = distinctScopes;

  // Mirror the project route's SSE slice, but for every open session's scope:
  // keep the question overlay live and invalidate all task queries so statuses
  // and titles across the bar stay fresh. Deps stay stable (scopes read via a
  // ref) so the EventSource is opened once, not re-subscribed on every reorder.
  useServerEvents(
    useCallback(
      (e) => {
        applyQuestionServerEvent(e);
        if (e.type.startsWith("task:")) {
          // Only refetch the scope the event actually belongs to — a task tick
          // in one project used to invalidate every open session's scope.
          const projectId = e.projectId;
          for (const p of distinctScopesRef.current) {
            if (p.id !== projectId) continue;
            void queryClient.invalidateQueries({
              queryKey: queryKeys.tasks(
                p.id,
                p.activeWorktreeId ?? null,
                p.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
              ),
            });
          }
        }
      },
      [queryClient],
    ),
  );

  // Resync with the main process on mount / session switch — but only when
  // focus mode is ALREADY active there (normal entry via enterFocusSession, or
  // a renderer reload landing on the focus URL while the window is floating).
  // The route itself never initiates the window transform: an unconditional
  // enter here could fire against a just-exited main process and re-shrink the
  // restored window (stale effect, or a held hotkey re-toggling through nav).
  const [alwaysOnTop, setAlwaysOnTopState] = useState(true);
  useEffect(() => {
    if (!hasSession) return;
    const electron = getElectron();
    if (!electron) return;
    let cancelled = false;
    void electron.focusMode
      .get()
      .then((state) => {
        if (cancelled || !state.active) return;
        return electron.focusMode.enter(taskId).then((s) => {
          if (!cancelled) setAlwaysOnTopState(s.alwaysOnTop);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [taskId, hasSession]);

  const toggleAlwaysOnTop = useCallback(() => {
    const electron = getElectron();
    if (!electron) return;
    void electron.focusMode
      .setAlwaysOnTop(!alwaysOnTop)
      .then((state) => setAlwaysOnTopState(state.alwaysOnTop))
      .catch(() => undefined);
  }, [alwaysOnTop]);

  // Native screenshot capture, mirroring the project route (which is unmounted
  // while floating, taking its hotkey handler and toolbar button with it): same
  // macOS-only gate, same capture flow. Captures land in a compact thumbnail
  // stack overlaid on the terminal (see the render below).
  const screenshotSupported = useMemo(() => isScreenshotSupported(), []);
  const addScreenshot = terminals.addScreenshot;
  const captureScreenshot = useCallback(async () => {
    const projectId = currentProjectId;
    if (!projectId) return;
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.screenshot.captureRegion();
    if ("error" in result) {
      toast.error(screenshotCaptureErrorMessage(result.error));
      return;
    }
    const shot = screenshotFromResult(result);
    if (shot) {
      playScreenshotCapture();
      addScreenshot({ ...shot, projectId });
    }
  }, [addScreenshot, currentProjectId]);
  useHotkey("screenshot.capture", () => void captureScreenshot(), {
    capture: true,
    enabled: screenshotSupported && hasSession,
  });

  // Collapsible session bar. Preference persists across launches; hiding it
  // hands the extra vertical space to the terminal without touching the session.
  const [barOpen, setBarOpen] = useState(loadBarOpenPref);
  const toggleBar = useCallback(() => {
    setBarOpen((prev) => {
      const next = !prev;
      saveBarOpenPref(next);
      return next;
    });
  }, []);

  const selectSession = useCallback(
    (id: string) => {
      if (id === taskId) return;
      switchFocusSession(router, id);
    },
    [router, taskId],
  );

  // Cycle to the next/prev tab in activity order (Cmd/Ctrl+Shift+]/[). Reads the
  // ordered list via a ref so the handlers stay stable.
  const orderedRef = useRef(orderedSessions);
  orderedRef.current = orderedSessions;
  const cycle = useCallback(
    (dir: 1 | -1) => {
      const list = orderedRef.current;
      if (list.length < 2) return;
      const idx = list.findIndex((s) => s.taskId === taskId);
      if (idx === -1) return;
      const next = list[(idx + dir + list.length) % list.length];
      if (next && next.taskId !== taskId) switchFocusSession(router, next.taskId);
    },
    [router, taskId],
  );

  // Exit paths: the toggle hotkey (capture: a focused xterm must not swallow
  // it), Cmd/Ctrl+W forwarded from the Electron main process (the project
  // route's archive handler is unmounted, so it exits focus mode instead),
  // and the header button. Key repeats are ignored — a held toggle chord would
  // otherwise exit here and re-enter from the project route it lands on.
  useHotkey(
    "session.focusMode",
    (e) => {
      if (e.repeat) return;
      exit();
    },
    { capture: true, enabled: hasSession },
  );
  const canCycle = hasSession && switchable.length > 1;
  useHotkey(
    "session.cycleNext",
    (e) => {
      if (e.repeat) return;
      cycle(1);
    },
    { capture: true, enabled: canCycle },
  );
  useHotkey(
    "session.cyclePrev",
    (e) => {
      if (e.repeat) return;
      cycle(-1);
    },
    { capture: true, enabled: canCycle },
  );
  useEffect(() => getElectron()?.onCloseIntent(exit), [exit]);

  if (!session) return null;

  const showBar = switchable.length >= 2;
  const scopeId = session.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID;
  const scopeKey = `${worktreeScopeKey(session.project.id, session.project.activeWorktreeId)}:${scopeId}`;
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Hidden per-scope task subscriptions keeping the bar's statuses live. */}
      {distinctScopes.map((project) => (
        <ScopeTaskSync
          key={scopeKeyForProject(project)}
          project={project}
          syncTask={syncTask}
        />
      ))}
      <FocusSessionHeader
        session={session}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onExit={exit}
        showBarToggle={showBar}
        barOpen={barOpen}
        onToggleBar={toggleBar}
        showScreenshot={screenshotSupported}
        onCaptureScreenshot={() => void captureScreenshot()}
      />
      {showBar && (
        <FocusSessionBar
          open={barOpen}
          sessions={orderedSessions}
          activeTaskId={taskId}
          unread={unread}
          onSelect={selectSession}
        />
      )}
      {/* data-task-id makes the terminal a drop target for thumbnail drags
          (sessionHostAtPoint), matching the grid cells / docked panel; the
          relative position anchors the focus-variant stack to the terminal
          area so it always clears the header and session bar. */}
      <div
        data-task-id={session.taskId}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <TerminalPane
          key={`${session.taskId}:${scopeKey}`}
          project={session.project}
          task={session.task}
          descriptor={session}
          isLast
          hideHeader
          onPtyReady={(ptyId) => terminals.setPtyId(session.taskId, ptyId, scopeKey)}
        />
        {/* Compact capture stack pinned top-right, over old scrollback rather
            than the prompt and freshest output at the bottom of the pane. */}
        {screenshotSupported && (
          <ScreenshotThumbnail projectId={session.project.id} variant="focus" />
        )}
      </div>
    </div>
  );
}

/** Activity-based ordering + unread badges for the session bar. Reordering is
 *  driven purely by task-status transitions (see focus-session-order); a manual
 *  tab switch never reorders. Status bookkeeping lives in a ref (it never needs
 *  to render); only the order and unread set drive re-renders. */
function useFocusSessionOrder(sessions: OpenTerminal[], activeTaskId: string) {
  const [order, setOrder] = useState<string[]>([]);
  const [unread, setUnread] = useState<string[]>([]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  const statusRef = useRef<Record<string, string>>({});

  const snapshot = useMemo<SessionSnapshot[]>(
    () => sessions.map((s) => ({ taskId: s.taskId, status: s.task.status })),
    [sessions],
  );
  // Signature of everything the reconcile depends on: every taskId+status and
  // the active tab. Reconcile re-runs exactly when this changes.
  const sig =
    snapshot.map((s) => `${s.taskId}:${s.status}`).join("|") + `#${activeTaskId}`;

  useEffect(() => {
    const next = reconcileFocusOrder(
      { order: orderRef.current, status: statusRef.current, unread: unreadRef.current },
      snapshot,
      activeTaskId,
    );
    statusRef.current = next.status;
    if (next.order.join("|") !== orderRef.current.join("|")) setOrder(next.order);
    if (next.unread.join("|") !== unreadRef.current.join("|")) setUnread(next.unread);
    // `sig` encodes every taskId+status and the active tab; snapshot/activeTaskId
    // are read fresh inside, so re-running on `sig` alone is exactly right.
  }, [sig]);

  const orderedSessions = useMemo(
    () => orderSessions(sessions, order),
    [sessions, order],
  );
  const unreadSet = useMemo(() => new Set(unread), [unread]);
  return { orderedSessions, unread: unreadSet };
}

/** Hidden task subscription for one open-session scope. Feeds the terminal
 *  store's syncTask so background tabs reflect live status/title while the
 *  project route (the usual driver) is unmounted in focus mode. */
function ScopeTaskSync({
  project,
  syncTask,
}: {
  project: ScopedProject;
  syncTask: (task: Task) => void;
}) {
  const { data: tasks } = useTasks(
    project.id,
    project.activeWorktreeId ?? null,
    project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
  );
  useEffect(() => {
    if (!tasks) return;
    for (const task of tasks) syncTask(task);
  }, [tasks, syncTask]);
  return null;
}

/** Thin draggable chrome: grabbing it moves the whole floating window.
 *  Buttons opt back out of the drag region via the global no-drag rule. */
function FocusSessionHeader({
  session,
  alwaysOnTop,
  onToggleAlwaysOnTop,
  onExit,
  showBarToggle,
  barOpen,
  onToggleBar,
  showScreenshot,
  onCaptureScreenshot,
}: {
  session: OpenTerminal;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  onExit: () => void;
  showBarToggle: boolean;
  barOpen: boolean;
  onToggleBar: () => void;
  showScreenshot: boolean;
  onCaptureScreenshot: () => void;
}) {
  // session.task is kept live by the ScopeTaskSync subscriptions above.
  const task = session.task;
  const statusMeta = STATUS_META[task.status];
  return (
    <div
      data-focus-session-header
      style={
        {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 6px 5px 8px",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          userSelect: "none",
          ["WebkitAppRegion" as never]: "drag",
        } as CSSProperties
      }
    >
      {showBarToggle && (
        <Tooltip content={barOpen ? "Hide session bar" : "Show session bar"}>
          <Btn
            variant="ghost"
            size="sm"
            icon="list"
            onClick={onToggleBar}
            aria-pressed={barOpen}
            aria-label={barOpen ? "Hide session bar" : "Show session bar"}
            style={{
              width: 30,
              padding: 0,
              color: barOpen ? "var(--accent)" : undefined,
            }}
          />
        </Tooltip>
      )}
      <StatusDot status={task.status} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.title}
      </div>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: statusMeta.color,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {statusMeta.label}
      </span>
      {showScreenshot && (
        <HotkeyTooltip action="screenshot.capture" label="Screenshot">
          <Btn
            variant="ghost"
            size="sm"
            icon="camera"
            onClick={onCaptureScreenshot}
            aria-label="Capture a screenshot"
            style={{ width: 30, padding: 0 }}
          />
        </HotkeyTooltip>
      )}
      {isElectron() && (
        <Tooltip content={alwaysOnTop ? "Always on top: on" : "Always on top: off"}>
          <Btn
            variant="ghost"
            size="sm"
            icon={alwaysOnTop ? "pin-fill" : "pin"}
            onClick={onToggleAlwaysOnTop}
            aria-pressed={alwaysOnTop}
            aria-label={alwaysOnTop ? "Disable always on top" : "Enable always on top"}
            style={{
              width: 30,
              padding: 0,
              color: alwaysOnTop ? "var(--accent)" : undefined,
            }}
          />
        </Tooltip>
      )}
      <HotkeyTooltip action="session.focusMode" label="Exit focus mode">
        <Btn
          variant="ghost"
          size="sm"
          icon="minimize"
          onClick={onExit}
          aria-label="Exit focused session mode"
          style={{ width: 30, padding: 0 }}
        />
      </HotkeyTooltip>
    </div>
  );
}
