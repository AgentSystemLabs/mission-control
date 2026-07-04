import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { StatusDot } from "~/components/ui/StatusDot";
import { HotkeyTooltip, Tooltip } from "~/components/ui/Tooltip";
import { TerminalPane } from "~/components/views/TerminalPane";
import { applyQuestionServerEvent } from "~/lib/agent-question-store";
import { STATUS_META } from "~/lib/design-meta";
import { getElectron, isElectron } from "~/lib/electron";
import { exitFocusSession } from "~/lib/focus-session";
import { useTerminals, type OpenTerminal } from "~/lib/terminal-store";
import { useHotkey } from "~/lib/use-hotkey";
import { useServerEvents } from "~/lib/use-events";
import { queryKeys, useTasks } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { worktreeScopeKey } from "~/shared/worktrees";

export const Route = createFileRoute("/focus/$taskId")({
  component: FocusSessionPage,
});

// Focused Session Mode: the Shell strips all app chrome on /focus/* and the
// Electron window is a small always-on-top floating card (see
// electron/focus-mode.ts), so this route IS the whole visible window — a thin
// draggable header plus one live TerminalPane. The pane's surface comes from
// the shared terminal-surface-cache, so the terminal carries over from the
// project view instantly, without a scrollback replay.
function FocusSessionPage() {
  const { taskId } = Route.useParams();
  const router = useRouter();
  const terminals = useTerminals();
  const queryClient = useQueryClient();
  const session = terminals.sessions.find((s) => s.taskId === taskId) ?? null;

  const exit = useCallback(() => {
    void exitFocusSession(router, taskId);
  }, [router, taskId]);

  // The session disappearing from the store (archived, killed, failed
  // revalidation — from any surface) is the one signal to leave focus mode.
  useEffect(() => {
    if (session) return;
    exit();
  }, [session, exit]);

  // Resync with the main process on mount — but only when focus mode is
  // ALREADY active there (normal entry via enterFocusSession, or a renderer
  // reload landing on the focus URL while the window is floating). The route
  // itself never initiates the window transform: an unconditional enter here
  // could fire against a just-exited main process and re-shrink the restored
  // window (stale effect, or a held hotkey re-toggling through navigation).
  const [alwaysOnTop, setAlwaysOnTopState] = useState(true);
  const hasSession = !!session;
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

  // The project route (which normally drives task-query invalidation and the
  // question store from SSE) is unmounted in focus mode — mirror the minimal
  // slice here so the status dot and the AskUserQuestion overlay stay live.
  const projectId = session?.project.id ?? null;
  const worktreeId = session?.project.activeWorktreeId ?? null;
  const scopeId = session?.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID;
  useServerEvents(
    useCallback(
      (e) => {
        applyQuestionServerEvent(e);
        if (e.type.startsWith("task:") && projectId) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.tasks(projectId, worktreeId, scopeId),
          });
        }
      },
      [queryClient, projectId, worktreeId, scopeId],
    ),
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
  useEffect(() => getElectron()?.onCloseIntent(exit), [exit]);

  if (!session) return null;

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
      <FocusSessionHeader
        session={session}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onExit={exit}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <TerminalPane
          key={`${session.taskId}:${scopeKey}`}
          project={session.project}
          task={session.task}
          descriptor={session}
          isLast
          hideHeader
          onPtyReady={(ptyId) => terminals.setPtyId(session.taskId, ptyId, scopeKey)}
        />
      </div>
    </div>
  );
}

/** Thin draggable chrome: grabbing it moves the whole floating window.
 *  Buttons opt back out of the drag region via the global no-drag rule. */
function FocusSessionHeader({
  session,
  alwaysOnTop,
  onToggleAlwaysOnTop,
  onExit,
}: {
  session: OpenTerminal;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  onExit: () => void;
}) {
  const { data: liveTasks } = useTasks(
    session.project.id,
    session.project.activeWorktreeId ?? null,
    session.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
  );
  const liveTask = liveTasks?.find((t) => t.id === session.taskId) ?? session.task;
  const statusMeta = STATUS_META[liveTask.status];
  return (
    <div
      data-focus-session-header
      style={
        {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 6px 5px 12px",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          userSelect: "none",
          ["WebkitAppRegion" as never]: "drag",
        } as CSSProperties
      }
    >
      <StatusDot status={liveTask.status} />
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
        {liveTask.title}
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
