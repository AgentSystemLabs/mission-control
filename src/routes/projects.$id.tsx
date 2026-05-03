import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { NewAgentDialog } from "~/components/views/NewAgentDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { FileFinderDialog } from "~/components/views/FileFinderDialog";
import { FileEditorDialog } from "~/components/views/FileEditorDialog";
import { LaunchCommandsDialog } from "~/components/views/LaunchCommandsDialog";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { Kbd, KbdAction } from "~/components/ui/Kbd";
import { useFormattedBinding } from "~/lib/keybindings/store";
import { Modal } from "~/components/ui/Modal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
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
import type { Task, TaskStatus } from "~/db/schema";
import {
  DUPLICATE_ACTIVE_SESSION_EVENT,
  pickByPriority,
  STATUS_META,
} from "~/lib/design-meta";
import { useTaskDensity } from "~/lib/use-task-density";
import { DensityToggle } from "~/components/ui/DensityToggle";

const projectSearchSchema = z.object({
  view: z.enum(["diff"]).optional(),
});

export const Route = createFileRoute("/projects/$id")({
  validateSearch: projectSearchSchema,
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
});

function MenuSeparator() {
  return (
    <div
      style={{
        height: 1,
        background: "var(--border)",
        margin: "4px 2px",
      }}
    />
  );
}

function ProjectPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: project, error: projectError } = useProject(id);
  const { data: tasks = [] } = useTasks(id);
  const { data: groups = [] } = useGroups();
  const { data: settings } = useSettings();
  const { data: gitStatus } = useGitStatus(id);
  const { density, setDensity } = useTaskDensity();
  const showDiffView = search.view === "diff";

  const openDiffView = useCallback(() => {
    router.navigate({
      to: "/projects/$id",
      params: { id },
      search: { view: "diff" },
    });
  }, [router, id]);

  const closeDiffView = useCallback(() => {
    router.navigate({
      to: "/projects/$id",
      params: { id },
      search: {},
    });
  }, [router, id]);
  const apiToken = settings?.apiToken ?? null;
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
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

  const editProjectHotkey = useFormattedBinding("project.edit");

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

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
    (s) => s.terminal.startCommand && launchCommandSet.has(s.terminal.startCommand.trim())
  );

  const stopLaunch = useCallback(async () => {
    setOverflowOpen(false);
    if (launchCommands.length === 0) return;
    setStopping(true);
    try {
      await killTerminalsByStartCommand(launchCommands.map((c) => c.command));
    } finally {
      setStopping(false);
    }
  }, [launchCommands, killTerminalsByStartCommand]);

  const runLaunch = useCallback(async () => {
    setOverflowOpen(false);
    if (launchCommands.length === 0) {
      setShowLaunchEmpty(true);
      return;
    }
    setLaunching(true);
    try {
      await killTerminalsByStartCommand(launchCommands.map((c) => c.command));
      for (const c of launchCommands) {
        await createTerminal({ name: c.name, startCommand: c.command });
      }
      setPanelOpen(true);
    } finally {
      setLaunching(false);
    }
  }, [launchCommands, killTerminalsByStartCommand, createTerminal, setPanelOpen]);

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
  const lastActiveTaskIdRef = useRef<string | null>(null);
  const activeTaskId =
    terminals.active && terminals.active.project.id === id
      ? terminals.active.taskId
      : null;
  useEffect(() => {
    if (activeTaskId !== null) {
      lastActiveTaskIdRef.current = activeTaskId;
      return;
    }
    const prev = lastActiveTaskIdRef.current;
    if (!prev || !project) return;
    const visible = tasks.filter((t) => !t.archived);
    if (visible.some((t) => t.id === prev)) return; // still there → deselect or refresh pending
    lastActiveTaskIdRef.current = null;
    const next = pickByPriority(visible);
    if (next) terminals.toggle(project, next);
  }, [activeTaskId, tasks, project, terminals]);

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
    setOverflowOpen(false);
    setPinning(true);
    try {
      await api.togglePin(project.id);
      await Promise.all([invalidateProject(), invalidateProjects()]);
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
    await createSession({
      agent: project.savedAgent,
      branch: project.branch || DEFAULT_BRANCH,
      skipPermissions: !!project.savedSkipPermissions,
      bareSession: project.savedAgent === "claude-code" ? !!project.savedBareSession : false,
    });
  }, [project, createSession]);

  const onNewAgentPrimary = useCallback(() => {
    if (showNewAgent || showEdit) return;
    if (project?.rememberAgentSettings && project.savedAgent) {
      void startWithSaved();
      return;
    }
    setShowNewAgent(true);
  }, [project, showNewAgent, showEdit, startWithSaved]);

  useHotkey("agent.new", onNewAgentPrimary, { ignoreEditable: true });

  useHotkey("project.edit", () => {
    if (showNewAgent) return;
    setShowEdit((v) => !v);
  });

  useHotkey(
    "project.runToggle",
    () => {
      if (showNewAgent || showEdit || confirmRemove) return;
      if (hasRunningLaunch) {
        if (!stopping) void stopLaunch();
      } else if (!launching) {
        void runLaunch();
      }
    },
    { ignoreEditable: true },
  );

  useHotkey(
    "file.finder",
    () => {
      if (openFileRel || showNewAgent || showEdit || confirmRemove) return;
      setFileFinderOpen((v) => !v);
    },
    { ignoreEditable: true },
  );

  const anyBlockingDialogOpen =
    showNewAgent ||
    showEdit ||
    confirmRemove ||
    confirmClearAll ||
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
      const currentId =
        terminals.active && terminals.active.project.id === project.id
          ? terminals.active.taskId
          : null;
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

  // Direct window-capture listener (not useHotkey) — xterm's focused textarea
  // intermittently masks the action-based hook after a focus change. Mirrors
  // the proven Cmd+[/Cmd+] pattern in __root.tsx. Cmd+Shift+] / Cmd+Shift+[
  // arrive as e.key="}" / e.key="{" on US layouts, so match by e.code instead.
  const cycleSessionRef = useRef(cycleSession);
  cycleSessionRef.current = cycleSession;

  const duplicateActiveSession = useCallback(() => {
    if (!project) return;
    if (anyBlockingDialogOpen) return;
    const active = terminals.active;
    if (!active || active.project.id !== project.id) return;
    const sourceTask = tasks.find((t) => t.id === active.taskId);
    if (!sourceTask) return;
    void createSession({
      agent: sourceTask.agent,
      branch: sourceTask.branch || project.branch || DEFAULT_BRANCH,
      skipPermissions: !!sourceTask.claudeSkipPermissions,
      bareSession: sourceTask.agent === "claude-code" ? !!sourceTask.claudeBareSession : false,
    });
  }, [project, tasks, terminals, createSession, anyBlockingDialogOpen]);
  const duplicateActiveSessionRef = useRef(duplicateActiveSession);
  duplicateActiveSessionRef.current = duplicateActiveSession;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.shiftKey || e.altKey) return;
      if (e.code === "BracketRight") {
        e.preventDefault();
        e.stopPropagation();
        cycleSessionRef.current(1);
      } else if (e.code === "BracketLeft") {
        e.preventDefault();
        e.stopPropagation();
        cycleSessionRef.current(-1);
      } else if (e.code === "KeyD") {
        e.preventDefault();
        e.stopPropagation();
        duplicateActiveSessionRef.current();
      }
    };
    const onDuplicateRequest = () => duplicateActiveSessionRef.current();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(DUPLICATE_ACTIVE_SESSION_EVENT, onDuplicateRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(DUPLICATE_ACTIVE_SESSION_EVENT, onDuplicateRequest);
    };
  }, []);

  useHotkey(
    "git.diff",
    () => {
      if (
        anyBlockingDialogOpen
      ) return;
      if (showDiffView) closeDiffView();
      else openDiffView();
    },
    { ignoreEditable: true },
  );

  const closePanelEnabled = !anyBlockingDialogOpen && terminals.active !== null;

  // Capture phase so xterm.js (focused terminal) can't swallow the key first.
  useHotkey("terminal.close", () => terminals.deselect(), {
    enabled: closePanelEnabled,
    capture: true,
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

  const activeId =
    terminals.active && terminals.active.project.id === project.id
      ? terminals.active.taskId
      : null;

  const toggleTerminal = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    terminals.toggle(project, task);
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await terminals.close(taskId);
    await api.deleteTask(taskId);
    await refresh();
  };

  const remove = () => {
    setConfirmRemove(true);
  };

  const confirmRemoveProject = async () => {
    if (!project) return;
    setConfirmRemove(false);
    await terminals.closeForProject(project.id);
    await api.deleteProject(project.id);
    router.navigate({ to: "/" });
  };

  const clearAll = async () => {
    setConfirmClearAll(false);
    await terminals.closeForProject(project.id);
    await Promise.all(visibleTasks.map((t) => api.deleteTask(t.id).catch(() => undefined)));
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

  if (showDiffView) {
    return (
      <>
        <CursorGlow />
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
      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px 80px" }} className="dot-grid-bg">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            rowGap: 10,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <div ref={overflowRef} style={{ position: "relative", minWidth: 0, flex: "0 1 auto" }}>
            <button
              onClick={() => setOverflowOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              title="Project actions"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "6px 10px 6px 6px",
                background: "none",
                border: "1px solid transparent",
                borderRadius: 10,
                cursor: "pointer",
                color: "var(--text)",
                maxWidth: "100%",
                minWidth: 0,
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.borderColor = "transparent";
              }}
            >
              <ProjectIcon project={project} size={32} />
              <h1
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-0.015em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
                title={project.name}
              >
                {project.name}
              </h1>
              {project.pinned && (
                <Icon
                  name="pin-fill"
                  size={13}
                  style={{ color: "var(--accent)", flexShrink: 0 }}
                />
              )}
              <Icon
                name="chevron-down"
                size={14}
                style={{ color: "var(--text-dim)", flexShrink: 0 }}
              />
            </button>
            {overflowOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  minWidth: 220,
                  padding: 4,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 2,
                  background: "var(--surface-3)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                  zIndex: 50,
                }}
              >
                {hasRunningLaunch ? (
                  <>
                    <Btn
                      variant="ghost"
                      icon="x"
                      onClick={stopLaunch}
                      disabled={stopping}
                      style={{ justifyContent: "flex-start" }}
                    >
                      {stopping ? "Stopping…" : "Stop launch"}
                      <KbdAction action="project.runToggle" />
                    </Btn>
                    <MenuSeparator />
                  </>
                ) : null}
                <Btn
                  variant="ghost"
                  icon="folder"
                  onClick={() => {
                    setOverflowOpen(false);
                    window.electronAPI?.openPath(project.path);
                  }}
                  style={{ justifyContent: "flex-start" }}
                  title={project.path}
                >
                  Reveal in Finder
                </Btn>
                {project.githubUrl && (
                  <Btn
                    variant="ghost"
                    icon="github"
                    onClick={() => {
                      setOverflowOpen(false);
                      window.open(project.githubUrl!, "_blank", "noreferrer");
                    }}
                    style={{ justifyContent: "flex-start" }}
                  >
                    Open GitHub
                  </Btn>
                )}
                <Btn
                  variant="ghost"
                  icon="git-branch"
                  onClick={() => {
                    setOverflowOpen(false);
                    openDiffView();
                  }}
                  style={{ justifyContent: "flex-start" }}
                  title={
                    gitStatus && gitStatus.changedCount > 0
                      ? `${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"} on ${gitStatus.branch}`
                      : `On branch ${gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH}`
                  }
                >
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH}
                    {gitStatus && gitStatus.changedCount > 0 && (
                      <span style={{ color: "var(--text-dim)" }}>
                        {" · "}
                        {gitStatus.changedCount} changed
                      </span>
                    )}
                  </span>
                  <KbdAction action="git.diff" />
                </Btn>
                <MenuSeparator />
                <Btn
                  variant={project.pinned ? "accent" : "ghost"}
                  icon={project.pinned ? "pin-fill" : "pin"}
                  onClick={toggleProjectPin}
                  disabled={pinning}
                  style={{ justifyContent: "flex-start" }}
                >
                  {pinning
                    ? project.pinned
                      ? "Unpinning..."
                      : "Pinning..."
                    : project.pinned
                      ? "Unpin project"
                      : "Pin project"}
                </Btn>
                <Btn
                  variant="ghost"
                  icon="play"
                  onClick={() => {
                    setOverflowOpen(false);
                    setShowLaunchConfig(true);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  Configure launch commands
                </Btn>
                <Btn
                  variant="ghost"
                  icon="settings"
                  onClick={() => {
                    setOverflowOpen(false);
                    setShowEdit(true);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  <span style={{ flex: 1, textAlign: "left" }}>Edit project</span>
                  <Kbd>{editProjectHotkey}</Kbd>
                </Btn>
                <MenuSeparator />
                <Btn
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    setOverflowOpen(false);
                    setConfirmRemove(true);
                  }}
                  style={{ justifyContent: "flex-start", color: "var(--danger)" }}
                  title="Remove this project from Mission Control. The folder on disk is not touched."
                >
                  Remove project
                </Btn>
              </div>
            )}
          </div>
          <RunStatusPill
            running={hasRunningLaunch}
            launching={launching}
            stopping={stopping}
            launchUrl={project.launchUrl ?? null}
            onStart={runLaunch}
            onOpenUrl={() =>
              project.launchUrl && window.electronAPI?.openExternal(project.launchUrl)
            }
          />
          <ProjectPinButton
            pinned={project.pinned}
            busy={pinning}
            onClick={toggleProjectPin}
          />
          <ProjectGitStatusButton
            branch={gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH}
            changedCount={gitStatus?.changedCount}
            onClick={openDiffView}
          />
          <div style={{ flex: 1 }} />
          <NewAgentButton
            project={project}
            onPrimary={onNewAgentPrimary}
            onConfigure={() => setShowNewAgent(true)}
          />
        </div>

        {visibleTasks.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-dim)",
                  lineHeight: 1.5,
                }}
              >
                Create and manage sessions that can work on tasks autonomously
                with Claude Code.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DensityToggle value={density} onChange={setDensity} />
              <Btn
                variant="ghost"
                icon="trash"
                onClick={() => setConfirmClearAll(true)}
                title="Stop and remove all sessions and terminals for this project"
              >
                Clear all
              </Btn>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {STATUS_DISPLAY_ORDER.map((status) => (
            <TaskColumn
              key={status}
              title={STATUS_META[status].label}
              color={STATUS_META[status].color}
              tasks={tasksByStatus[status]}
              activeId={activeId}
              density={density}
              onToggle={toggleTerminal}
              onDelete={deleteTask}
            />
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
      </div>

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
        onDelete={remove}
      />

      <FileFinderDialog
        open={fileFinderOpen}
        projectRoot={project.path}
        onClose={() => setFileFinderOpen(false)}
        onPick={(rel) => setOpenFileRel(rel)}
      />

      <FileEditorDialog
        projectRoot={project.path}
        relPath={openFileRel}
        onClose={() => setOpenFileRel(null)}
      />

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
            <Btn variant="ghost" onClick={() => setShowLaunchEmpty(false)}>
              Close <Kbd variant="inline">Esc</Kbd>
            </Btn>
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
        open={confirmClearAll}
        onClose={() => setConfirmClearAll(false)}
        onConfirm={clearAll}
        title="Clear all sessions"
        confirmLabel="Clear all"
        icon="trash"
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Stop and remove every session and terminal in &ldquo;{project.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {visibleTasks.length} session{visibleTasks.length === 1 ? "" : "s"} will be deleted and their terminals killed. This only affects this project.
        </div>
      </ConfirmDialog>
      </div>
    </>
  );
}

function ProjectPinButton({
  pinned,
  busy,
  onClick,
}: {
  pinned: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const label = busy
    ? pinned
      ? "Unpinning..."
      : "Pinning..."
    : pinned
      ? "Pinned"
      : "Pin";
  const actionLabel = pinned ? "Unpin project" : "Pin project";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={actionLabel}
      aria-label={actionLabel}
      aria-pressed={pinned}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 12px",
        borderRadius: 999,
        border: `1px solid ${pinned ? "var(--accent-border)" : "var(--border)"}`,
        background: pinned ? "var(--accent-faint)" : "var(--surface-0)",
        color: pinned ? "var(--accent)" : "var(--text-dim)",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (busy) return;
        e.currentTarget.style.background = pinned ? "var(--accent-dim)" : "var(--surface-2)";
        e.currentTarget.style.borderColor = pinned ? "var(--accent)" : "var(--border-strong)";
        e.currentTarget.style.color = pinned ? "var(--accent)" : "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = pinned ? "var(--accent-faint)" : "var(--surface-0)";
        e.currentTarget.style.borderColor = pinned ? "var(--accent-border)" : "var(--border)";
        e.currentTarget.style.color = pinned ? "var(--accent)" : "var(--text-dim)";
      }}
    >
      <Icon name={pinned ? "pin-fill" : "pin"} size={12} />
      <span>{label}</span>
    </button>
  );
}

function ProjectGitStatusButton({
  branch,
  changedCount,
  onClick,
}: {
  branch: string;
  changedCount: number | undefined;
  onClick: () => void;
}) {
  const changedLabel =
    changedCount === undefined
      ? "Checking…"
      : `${changedCount} changed`;
  const title =
    changedCount === undefined
      ? `Open Get Diff for ${branch}`
      : `Open Get Diff: ${changedCount} changed file${changedCount === 1 ? "" : "s"} on ${branch}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        minWidth: 0,
        maxWidth: 320,
        padding: "0 12px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--surface-0)",
        color: "var(--text-dim)",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface-0)";
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = "var(--text-dim)";
      }}
    >
      <Icon name="git-branch" size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {branch}
      </span>
      <span style={{ color: "var(--text-faint)", flexShrink: 0 }}>·</span>
      <span
        style={{
          color: changedCount && changedCount > 0 ? "var(--accent)" : "var(--text-dim)",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {changedLabel}
      </span>
      <KbdAction action="git.diff" />
    </button>
  );
}

function RunStatusPill({
  running,
  launching,
  stopping,
  launchUrl,
  onStart,
  onOpenUrl,
}: {
  running: boolean;
  launching: boolean;
  stopping: boolean;
  launchUrl: string | null;
  onStart: () => void;
  onOpenUrl: () => void;
}) {
  const busy = launching || stopping;
  const label = stopping
    ? "Stopping…"
    : launching
      ? "Starting…"
      : running
        ? "Running"
        : "Offline";

  const interactive = !busy && (running ? !!launchUrl : true);
  const onClick = busy
    ? undefined
    : running
      ? launchUrl
        ? onOpenUrl
        : undefined
      : onStart;

  const title = busy
    ? label
    : running
      ? launchUrl
        ? `Open ${launchUrl}`
        : "Running"
      : "Run launch commands";

  const tone = running || launching ? "active" : "idle";
  const dotColor = tone === "active" ? "var(--accent)" : "var(--text-faint)";
  const borderColor = tone === "active" ? "var(--accent-border)" : "var(--border)";
  const background = tone === "active" ? "var(--accent-faint)" : "var(--surface-0)";
  const fg = tone === "active" ? "var(--accent)" : "var(--text-dim)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 12px",
        borderRadius: 999,
        border: `1px solid ${borderColor}`,
        background,
        color: fg,
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: interactive ? "pointer" : "default",
        opacity: busy ? 0.7 : 1,
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
        boxShadow: running ? "0 0 8px var(--accent-glow)" : "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: running ? "0 0 6px var(--accent-glow)" : "none",
          animation: launching || stopping ? "pulse-border 1.4s ease-in-out infinite" : "none",
        }}
      />
      <span>{label}</span>
      {running && launchUrl && (
        <>
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span
            style={{
              color: "var(--text-dim)",
              maxWidth: 200,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {launchUrl.replace(/^https?:\/\//, "")}
          </span>
          <Icon name="globe" size={12} style={{ color: "var(--text-faint)" }} />
        </>
      )}
      <KbdAction action="project.runToggle" />
    </button>
  );
}
