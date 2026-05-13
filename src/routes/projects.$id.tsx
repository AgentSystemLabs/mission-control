import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { NewAgentDialog } from "~/components/views/NewAgentDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { FileFinderDialog } from "~/components/views/FileFinderDialog";
const FileEditorDialog = lazy(() =>
  import("~/components/views/FileEditorDialog").then((m) => ({ default: m.FileEditorDialog })),
);
import { LaunchCommandsDialog } from "~/components/views/LaunchCommandsDialog";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { Modal } from "~/components/ui/Modal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { newSessionId } from "~/lib/claude-command";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { useServerEvents } from "~/lib/use-events";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { DEFAULT_BRANCH, parseLaunchCommands, STATUS_DISPLAY_ORDER, TASK_STATUSES } from "~/shared/domain";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import {
  groupsQueryOptions,
  projectQueryOptions,
  queryKeys,
  settingsQueryOptions,
  tasksQueryOptions,
  useGroups,
  useProject,
  useSettings,
  useTasks,
} from "~/queries";
import { gitStatusQueryOptions, useGitStatus } from "~/queries/git";
import { GitDiffView } from "~/components/views/GitDiffView";
import { RouteErrorBoundary } from "~/components/ui/RouteErrorBoundary";
import { InstallSkillsButton } from "~/components/views/InstallSkillsButton";
import { HeaderActions } from "~/components/ui/HeaderActionsSlot";
import type { Task, TaskStatus } from "~/db/schema";
import { pickByPriority } from "~/lib/design-meta";
import { TASK_STATUS_META } from "~/shared/domain";
import { isLoopbackHost } from "~/shared/loopback";
import { ProjectPageHeader } from "~/components/views/ProjectPage/ProjectPageHeader";
import { RunStatusPill } from "~/components/views/ProjectPage/RunStatusPill";
import { useDuplicateSessionListener } from "~/components/views/ProjectPage/useDuplicateSessionListener";
import { useProjectHotkeys } from "~/components/views/ProjectPage/useProjectHotkeys";

export const Route = createFileRoute("/projects/$id")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectQueryOptions(params.id)),
      context.queryClient.ensureQueryData(tasksQueryOptions(params.id)),
      context.queryClient.ensureQueryData(groupsQueryOptions()),
      context.queryClient.ensureQueryData(settingsQueryOptions()),
      context.queryClient
        .ensureQueryData(gitStatusQueryOptions(params.id))
        .catch(() => null),
    ]),
  component: ProjectPage,
  errorComponent: ({ error, reset }) => (
    <RouteErrorBoundary error={error} reset={reset} />
  ),
});

function launchUrlPort(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (!isLoopbackHost(url.hostname)) return [];
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? [port] : [];
  } catch {
    return [];
  }
}

function ProjectPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: project, error: projectError } = useProject(id);
  const { data: tasks = [] } = useTasks(id);
  const { data: groups = [] } = useGroups();
  const { data: settings } = useSettings();
  const { data: gitStatus } = useGitStatus(id);
  const [showDiffView, setShowDiffView] = useState(false);

  const openDiffView = useCallback(() => {
    setShowDiffView(true);
  }, []);

  const closeDiffView = useCallback(() => {
    setShowDiffView(false);
  }, []);
  const [apiToken, setLocalApiToken] = useState<string | null>(null);
  useEffect(() => {
    const electron = getElectron();
    if (!electron) return;
    void electron.getApiToken().then((t) => setLocalApiToken(t ?? null)).catch(() => {});
  }, []);
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmClearFinished, setConfirmClearFinished] = useState(false);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [openFileRel, setOpenFileRel] = useState<string | null>(null);
  const [showLaunchConfig, setShowLaunchConfig] = useState(false);
  const [showLaunchEmpty, setShowLaunchEmpty] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pinning, setPinning] = useState(false);
  const launchCommands = parseLaunchCommands(project?.launchCommands ?? null);

  useEffect(() => {
    if (projectError) router.navigate({ to: "/" });
  }, [projectError, router]);

  const terminals = useTerminals();
  const {
    setProject: setActiveUserTerminalProject,
    createTerminal,
    killTerminalsByStartCommand,
    setPanelOpen,
    sessions: userTerminalSessions,
  } = useUserTerminals();
  const launchCommandSet = new Set(
    launchCommands.map((c) => c.command.trim()).filter(Boolean)
  );
  const hasRunningLaunch = userTerminalSessions.some(
    (s) => s.ptyId && s.terminal.startCommand && launchCommandSet.has(s.terminal.startCommand.trim())
  );
  const launchPorts = useMemo(
    () => launchUrlPort(project?.launchUrl ?? null),
    [project?.launchUrl]
  );

  const stopLaunch = useCallback(async () => {
    if (launchCommands.length === 0) return;
    setStopping(true);
    try {
      await killTerminalsByStartCommand(launchCommands.map((c) => c.command), {
        ports: launchPorts,
      });
    } finally {
      setStopping(false);
    }
  }, [launchCommands, launchPorts, killTerminalsByStartCommand]);

  const runLaunch = useCallback(async () => {
    if (launchCommands.length === 0) {
      setShowLaunchEmpty(true);
      return;
    }
    setLaunching(true);
    try {
      await killTerminalsByStartCommand(launchCommands.map((c) => c.command), {
        ports: launchPorts,
      });
      for (const c of launchCommands) {
        await createTerminal({ name: c.name, startCommand: c.command });
      }
      setPanelOpen(true);
    } finally {
      setLaunching(false);
    }
  }, [launchCommands, launchPorts, killTerminalsByStartCommand, createTerminal, setPanelOpen]);

  useEffect(() => {
    if (project) setActiveUserTerminalProject(project);
  }, [project, setActiveUserTerminalProject]);

  useEffect(() => {
    for (const task of tasks) terminals.syncTask(task);
  }, [tasks, terminals.syncTask]);

  // When the active session is deleted/archived, jump to the next
  // highest-priority card. Plain deselect (Cmd+L, X) leaves the panel closed.
  // We hold the prev active id across renders until the tasks query catches
  // up — only then can we tell deletion (task gone) from deselect (still there).
  // Scope the ref to {projectId, taskId} so the route component being reused
  // across project switches doesn't make a stale ref look like a deletion in
  // the new project (which would auto-open a session there).
  const lastActiveRef = useRef<{ projectId: string; taskId: string } | null>(null);
  const activeTaskId = terminals.activeTaskIdFor(id);
  const lastHiddenSessionRef = useRef<{ projectId: string; taskId: string } | null>(null);
  useEffect(() => {
    if (activeTaskId !== null) {
      lastActiveRef.current = { projectId: id, taskId: activeTaskId };
      return;
    }
    const prev = lastActiveRef.current;
    if (!prev || prev.projectId !== id || !project) return;
    const visible = tasks.filter((t) => !t.archived);
    if (visible.some((t) => t.id === prev.taskId)) return;
    lastActiveRef.current = null;
    const next = pickByPriority(visible);
    if (next) terminals.toggle(project, next);
  }, [activeTaskId, tasks, project, terminals, id]);

  // Rehydrate after reload: if a persisted activeTaskId resolves to an
  // existing task for this project, materialize a session entry so the panel
  // reopens without requiring a click.
  useEffect(() => {
    if (!project) return;
    const tid = terminals.activeTaskIdFor(project.id);
    if (!tid) return;
    const task = tasks.find((t) => t.id === tid);
    if (task) terminals.rehydrate(project, task);
  }, [project, tasks, terminals]);

  const invalidateProject = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
    [queryClient, id]
  );
  const invalidateTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(id) }),
    [queryClient, id]
  );
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const refresh = useCallback(async () => {
    await Promise.all([invalidateProject(), invalidateTasks(), invalidateProjects()]);
  }, [invalidateProject, invalidateTasks, invalidateProjects]);

  const toggleProjectPin = useCallback(async () => {
    if (!project || pinning) return;
    setPinning(true);
    try {
      await api.togglePin(project.id);
      await Promise.all([invalidateProject(), invalidateProjects()]);
    } catch (err) {
      toast.error("Failed to toggle pin", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPinning(false);
    }
  }, [project, pinning, invalidateProject, invalidateProjects]);

  const createSession = useCallback(
    async (payload: {
      agent: Task["agent"];
      branch: string;
      skipPermissions: boolean;
      bareSession: boolean;
    }) => {
      if (!project || !apiToken) return;
      const isClaude = payload.agent === "claude-code";
      const created = await api.createTaskInternal(
        project.id,
        {
          title: TITLE_WAITING,
          agent: payload.agent,
          branch: payload.branch,
          claudeSessionId: isClaude ? newSessionId() : undefined,
          claudeBareSession: isClaude ? payload.bareSession : undefined,
          claudeSkipPermissions: agentSupportsSkipPermissions(payload.agent)
            ? payload.skipPermissions
            : undefined,
        },
        apiToken
      );
      terminals.toggle(project, created.task);
      await refresh();
    },
    [project, apiToken, refresh, terminals]
  );

  const startWithSaved = useCallback(async () => {
    if (!project) return;
    if (!(project.rememberAgentSettings && project.savedAgent)) return;
    try {
      await createSession({
        agent: project.savedAgent,
        branch: project.branch || DEFAULT_BRANCH,
        skipPermissions: !!project.savedSkipPermissions,
        bareSession: project.savedAgent === "claude-code" ? !!project.savedBareSession : false,
      });
    } catch (err) {
      toast.error("Failed to start session", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [project, createSession]);

  const onNewAgentPrimary = useCallback(() => {
    if (showNewAgent || showEdit) return;
    if (project?.rememberAgentSettings && project.savedAgent) {
      void startWithSaved();
      return;
    }
    setShowNewAgent(true);
  }, [project, showNewAgent, showEdit, startWithSaved]);

  const anyBlockingDialogOpen =
    showNewAgent ||
    showEdit ||
    confirmRemove ||
    fileFinderOpen ||
    openFileRel !== null ||
    showLaunchConfig ||
    showLaunchEmpty;

  const cycleSession = useCallback(
    (direction: 1 | -1) => {
      if (!project) return;
      if (anyBlockingDialogOpen) return;
      const visible = tasks.filter((t) => !t.archived);
      if (visible.length === 0) return;
      const ordered: Task[] = [];
      for (const status of STATUS_DISPLAY_ORDER) {
        for (const t of visible) if (t.status === status) ordered.push(t);
      }
      if (ordered.length === 0) return;
      const currentId = terminals.activeTaskIdFor(project.id);
      // Panel closed: open the highest-priority card instead of cycling.
      if (!currentId) {
        const firstByPriority = pickByPriority(visible);
        if (!firstByPriority) return;
        terminals.toggle(project, firstByPriority);
        return;
      }
      const idx = ordered.findIndex((t) => t.id === currentId);
      if (idx === -1) return;
      const nextIdx = (idx + direction + ordered.length) % ordered.length;
      const nextTask = ordered[nextIdx];
      if (!nextTask || nextTask.id === currentId) return;
      terminals.toggle(project, nextTask);
    },
    [project, tasks, terminals, anyBlockingDialogOpen],
  );

  const duplicateActiveSession = useCallback(() => {
    if (!project) return;
    if (anyBlockingDialogOpen) return;
    const active = terminals.activeFor(project.id);
    if (!active) return;
    const sourceTask = tasks.find((t) => t.id === active.taskId);
    if (!sourceTask) return;
    void (async () => {
      try {
        await createSession({
          agent: sourceTask.agent,
          branch: sourceTask.branch || project.branch || DEFAULT_BRANCH,
          skipPermissions: !!sourceTask.claudeSkipPermissions,
          bareSession: sourceTask.agent === "claude-code" ? !!sourceTask.claudeBareSession : false,
        });
      } catch (err) {
        toast.error("Failed to start session", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [project, tasks, terminals, createSession, anyBlockingDialogOpen]);

  useDuplicateSessionListener(cycleSession, duplicateActiveSession);

  const hiddenSession = lastHiddenSessionRef.current;
  const canRestoreHiddenSession =
    !!project &&
    hiddenSession?.projectId === project.id &&
    terminals.sessions.some(
      (s) => s.taskId === hiddenSession.taskId && s.project.id === project.id,
    ) &&
    tasks.some((t) => t.id === hiddenSession.taskId && !t.archived);
  const closePanelEnabled =
    !anyBlockingDialogOpen && !!project
      ? terminals.activeFor(project.id) !== null || canRestoreHiddenSession
      : false;

  const onTerminalClose = useCallback(() => {
    if (!project) return;
    const active = terminals.activeFor(project.id);
    if (active) {
      lastHiddenSessionRef.current = { projectId: project.id, taskId: active.taskId };
      terminals.deselect(project.id);
      return;
    }
    const hidden = lastHiddenSessionRef.current;
    if (!hidden || hidden.projectId !== project.id) return;
    const sessionStillOpen = terminals.sessions.some(
      (s) => s.taskId === hidden.taskId && s.project.id === project.id,
    );
    if (!sessionStillOpen) return;
    const task = tasks.find((t) => t.id === hidden.taskId && !t.archived);
    if (!task) return;
    terminals.toggle(project, task);
  }, [project, terminals, tasks]);

  useProjectHotkeys({
    onNewAgentPrimary,
    setShowEdit,
    showNewAgent,
    showEdit,
    confirmRemove,
    hasRunningLaunch,
    stopping,
    launching,
    runLaunch,
    stopLaunch,
    openFileRel,
    setFileFinderOpen,
    anyBlockingDialogOpen,
    showDiffView,
    openDiffView,
    closeDiffView,
    closePanelEnabled,
    onTerminalClose,
  });

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("task:")) {
          void invalidateTasks();
          void invalidateProject();
        } else if (e.type.startsWith("project:")) {
          void invalidateProject();
          void invalidateProjects();
        }
      },
      [invalidateTasks, invalidateProject, invalidateProjects]
    )
  );

  if (!project) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          flex: 1,
          padding: 32,
          color: "var(--text-dim)",
          fontFamily: "var(--mono)",
          fontSize: 12,
        }}
      >
        Loading…
      </div>
    );
  }

  const visibleTasks = tasks.filter((t) => !t.archived);
  const tasksByStatus = TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = [];
      return acc;
    },
    {} as Record<TaskStatus, Task[]>
  );
  for (const t of visibleTasks) tasksByStatus[t.status].push(t);

  const activeId = terminals.activeTaskIdFor(project.id);

  const toggleTerminal = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const active = terminals.activeFor(project.id);
    if (active?.taskId === taskId) {
      lastHiddenSessionRef.current = { projectId: project.id, taskId };
    }
    terminals.toggle(project, task);
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await terminals.close(taskId);
    await api.deleteTask(taskId);
    await refresh();
  };

  const confirmRemoveProject = async () => {
    if (!project) return;
    setConfirmRemove(false);
    await terminals.closeForProject(project.id);
    await api.deleteProject(project.id);
    router.navigate({ to: "/" });
  };

  const clearFinished = async () => {
    setConfirmClearFinished(false);
    const finished = tasksByStatus.finished;
    await Promise.all(
      finished.map(async (t) => {
        await terminals.close(t.id).catch(() => undefined);
        await api.deleteTask(t.id).catch(() => undefined);
      })
    );
    await refresh();
  };

  const startAgent = async (data: {
    agent: Task["agent"];
    title: string;
    branch: string;
    dangerouslySkipPermissions: boolean;
    bareSession: boolean;
  }) => {
    setShowNewAgent(false);
    await createSession({
      agent: data.agent,
      branch: data.branch,
      skipPermissions: data.dangerouslySkipPermissions,
      bareSession: data.bareSession,
    });
  };

  const headerActions = (
    <HeaderActions>
      <RunStatusPill
        running={hasRunningLaunch}
        launching={launching}
        stopping={stopping}
        launchUrl={project.launchUrl ?? null}
        onStart={runLaunch}
        onOpenUrl={() =>
          project.launchUrl && window.electronAPI?.openExternal(project.launchUrl)
        }
        onStop={stopLaunch}
      />
      <span style={{ width: 12 }} aria-hidden />
      <InstallSkillsButton projectPath={project.path} />
    </HeaderActions>
  );

  if (showDiffView) {
    return (
      <>
        <CursorGlow />
        {headerActions}
        <GitDiffView
          projectId={project.id}
          projectPath={project.path}
          onBack={closeDiffView}
        />
      </>
    );
  }

  return (
    <>
      <CursorGlow />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
        className="dot-grid-bg"
      >
      <CardFrame
        style={{
          width: "100%",
          minHeight: "100%",
          flexShrink: 0,
          boxSizing: "border-box",
          padding: 8,
        }}
      >
        <ProjectPageHeader
          project={project}
          gitStatus={gitStatus}
          hasRunningLaunch={hasRunningLaunch}
          stopping={stopping}
          stopLaunch={stopLaunch}
          pinning={pinning}
          toggleProjectPin={toggleProjectPin}
          openDiffView={openDiffView}
          setShowLaunchConfig={setShowLaunchConfig}
          setShowEdit={setShowEdit}
          setConfirmRemove={setConfirmRemove}
          setFileFinderOpen={setFileFinderOpen}
          headerActions={headerActions}
        />

        <div
          aria-hidden
          style={{
            height: 1,
            background: "var(--border)",
            margin: "0 0 22px",
          }}
        />

        {visibleTasks.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
              paddingInline: 12,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--text)",
                  letterSpacing: "-0.01em",
                }}
              >
                Sessions
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <NewAgentButton
                project={project}
                onPrimary={onNewAgentPrimary}
                onConfigure={() => setShowNewAgent(true)}
              />
            </div>
          </div>
        )}
        {visibleTasks.length > 0 && (
          <div
            aria-hidden
            style={{
              height: 1,
              background: "var(--border)",
              margin: "0 12px 16px",
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            paddingInline: 12,
            boxSizing: "border-box",
          }}
        >
          {STATUS_DISPLAY_ORDER.filter((s) => tasksByStatus[s].length > 0).map((status, idx) => (
            <Fragment key={status}>
              {idx > 0 && (
                <div
                  aria-hidden
                  style={{ height: 1, background: "var(--border)" }}
                />
              )}
              <TaskColumn
                title={TASK_STATUS_META[status].label}
                color={TASK_STATUS_META[status].color}
                tasks={tasksByStatus[status]}
                activeId={activeId}
                onToggle={toggleTerminal}
                onDelete={deleteTask}
                headerAction={
                  status === "finished" && tasksByStatus.finished.length > 0 ? (
                    <Btn
                      variant="ghost"
                      icon="trash"
                      onClick={() => setConfirmClearFinished(true)}
                      title="Remove all finished sessions"
                    >
                      Clear
                    </Btn>
                  ) : undefined
                }
              />
            </Fragment>
          ))}
          {visibleTasks.length === 0 && (
            <EmptyState
              title="No active sessions"
              subtitle="Start a new session to begin working on this project."
              action={
                <NewAgentButton
                  project={project}
                  onPrimary={onNewAgentPrimary}
                  onConfigure={() => setShowNewAgent(true)}
                />
              }
            />
          )}
        </div>
      </CardFrame>

      <NewAgentDialog
        open={showNewAgent}
        project={project}
        onClose={() => setShowNewAgent(false)}
        onStart={startAgent}
        onPersistRemember={async (patch) => {
          queryClient.setQueryData(queryKeys.project(project.id), (prev: typeof project | undefined) =>
            prev ? { ...prev, ...patch } : prev
          );
          await api.updateProject(project.id, patch);
          await refresh();
        }}
      />

      <ProjectDialog
        open={showEdit}
        project={project}
        groups={groups}
        onClose={() => setShowEdit(false)}
        onSave={async (data) => {
          await api.updateProject(project.id, data);
          setShowEdit(false);
          await refresh();
        }}
      />

      <FileFinderDialog
        open={fileFinderOpen}
        projectId={project.id}
        onClose={() => setFileFinderOpen(false)}
        onPick={(rel) => setOpenFileRel(rel)}
      />

      <Suspense fallback={null}>
        <FileEditorDialog
          projectId={project.id}
          relPath={openFileRel}
          onClose={() => setOpenFileRel(null)}
        />
      </Suspense>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={confirmRemoveProject}
        title="Remove project"
        confirmLabel="Remove"
        icon="trash"
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Remove &ldquo;{project.name}&rdquo; from MissionControl?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          This only unlinks the project — the files at {project.path} are not touched.
        </div>
      </ConfirmDialog>

      <LaunchCommandsDialog
        open={showLaunchConfig}
        project={project}
        onClose={() => setShowLaunchConfig(false)}
        onSave={async (next) => {
          await api.updateProject(project.id, { launchCommands: next });
          await refresh();
        }}
      />

      <Modal
        open={showLaunchEmpty}
        onClose={() => setShowLaunchEmpty(false)}
        title="No launch commands"
        width={420}
        footer={
          <>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn variant="ghost" onClick={() => setShowLaunchEmpty(false)}>
                Close
              </Btn>
            </StaticHotkeyTooltip>
            <Btn
              variant="primary"
              icon="settings"
              onClick={() => {
                setShowLaunchEmpty(false);
                setShowLaunchConfig(true);
              }}
            >
              Configure
            </Btn>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          You haven't configured any launch commands for this project yet. Open the configuration
          modal to add up to 5 commands that will run when you press Launch.
        </p>
      </Modal>

      <ConfirmDialog
        open={confirmClearFinished}
        onClose={() => setConfirmClearFinished(false)}
        onConfirm={clearFinished}
        title="Clear finished sessions"
        confirmLabel="Clear"
        icon="trash"
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Remove all finished sessions in &ldquo;{project.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {tasksByStatus.finished.length} finished session{tasksByStatus.finished.length === 1 ? "" : "s"} will be deleted. Other sessions are unaffected.
        </div>
      </ConfirmDialog>
      </div>
    </>
  );
}
