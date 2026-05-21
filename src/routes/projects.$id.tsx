import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { NewAgentDialog } from "~/components/views/NewAgentDialog";
import {
  CodexHooksNoticeDialog,
  hasSeenCodexHooksNotice,
  markCodexHooksNoticeSeen,
} from "~/components/views/CodexHooksNoticeDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { FileFinderDialog } from "~/components/views/FileFinderDialog";
import { FileEditorDialog } from "~/components/views/FileEditorDialog";
import { LaunchCommandsDialog } from "~/components/views/LaunchCommandsDialog";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { Modal } from "~/components/ui/Modal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { newSessionId } from "~/lib/claude-command";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { useServerEvents } from "~/lib/use-events";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { DEFAULT_BRANCH, parseLaunchCommands, STATUS_DISPLAY_ORDER, TASK_STATUSES } from "~/shared/domain";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import {
  queryKeys,
  useApiToken,
  useEntitlements,
  useGroups,
  useProject,
  useTasks,
  useWorktrees,
} from "~/queries";
import { useGitStatus } from "~/queries/git";
import { GitDiffView } from "~/components/views/GitDiffView";
import { CommitPushButton } from "~/components/views/CommitPushButton";
import { InstallSkillsButton } from "~/components/views/InstallSkillsButton";
import { featureFlags } from "~/shared/feature-flags";
import { HeaderActions } from "~/components/ui/HeaderActionsSlot";
import { InstallSkillsMenuItem } from "~/components/views/InstallSkillsMenuItem";
import { agentCanLaunch, useCliAvailability } from "~/lib/cli-availability";
import {
  SESSION_NOTIFICATION_OPEN_EVENT,
  clearPendingSessionOpen,
  readPendingSessionOpen,
  type PendingSessionOpen,
} from "~/lib/session-notification-store";
import type { Task, TaskStatus } from "~/db/schema";
import type { ProjectPathStatus } from "~/shared/projects";
import type { WorktreeInfo } from "~/shared/worktrees";
import { MAIN_WORKTREE_ID, worktreeScopeKey } from "~/shared/worktrees";
import {
  DUPLICATE_ACTIVE_SESSION_EVENT,
  pickByPriority,
  STATUS_META,
} from "~/lib/design-meta";

export const Route = createFileRoute("/projects/$id")({
  component: ProjectPage,
});

type ProjectPathCheck =
  | { state: "idle" | "checking" | "valid" }
  | { state: "invalid"; status: Extract<ProjectPathStatus, { ok: false }> }
  | { state: "error"; message: string };

function launchUrlPort(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return [];
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? [port] : [];
  } catch {
    return [];
  }
}

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedWorktreeByProject, setSelectedWorktreeByProject] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("mc.selectedWorktreeByProject");
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "mc.selectedWorktreeByProject",
        JSON.stringify(selectedWorktreeByProject),
      );
    } catch {
      /* ignore */
    }
  }, [selectedWorktreeByProject]);
  const projectQuery = useProject(id);
  const worktreesQuery = useWorktrees(id);
  const groupsQuery = useGroups();
  const project = projectQuery.data;
  const worktreesEnabled = featureFlags.worktrees;
  const worktrees = worktreesQuery.data ?? [];
  const selectedWorktreeKey = worktreesEnabled
    ? selectedWorktreeByProject[id] || MAIN_WORKTREE_ID
    : MAIN_WORKTREE_ID;
  const selectedWorktree =
    worktrees.find((w) => w.id === selectedWorktreeKey) ??
    worktrees.find((w) => w.id === MAIN_WORKTREE_ID) ??
    null;
  const selectedWorktreeId = worktreesEnabled && !selectedWorktree?.isMain ? selectedWorktree?.id ?? null : null;
  const selectedWorktreePath = worktreesEnabled
    ? selectedWorktree?.path ?? project?.path ?? ""
    : project?.path ?? "";
  const selectedScopeKey = worktreeScopeKey(id, selectedWorktreeId);
  const scopedProject = useMemo(
    () =>
      project
        ? {
            ...project,
            path: selectedWorktreePath || project.path,
            activeWorktreeId: selectedWorktreeId,
          }
        : null,
    [project, selectedWorktreeId, selectedWorktreePath],
  );
  const [projectPathCheck, setProjectPathCheck] = useState<ProjectPathCheck>({
    state: "idle",
  });
  const [projectPathCheckRevision, setProjectPathCheckRevision] = useState(0);
  useEffect(() => {
    if (!project) {
      setProjectPathCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    setProjectPathCheck({ state: "checking" });
    void api
      .getProjectPathStatus(project.id, selectedWorktreeId)
      .then(({ status }) => {
        if (cancelled) return;
        setProjectPathCheck(status.ok ? { state: "valid" } : { state: "invalid", status });
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectPathCheck({
          state: "error",
          message: error?.message || "Could not verify this project path.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.path, selectedWorktreeId, selectedWorktreePath, projectPathCheckRevision]);
  const projectPathReady = projectPathCheck.state === "valid";
  const projectPathIssue =
    projectPathCheck.state === "invalid" ? projectPathCheck.status : null;
  const terminalProject = projectPathReady ? scopedProject : null;
  useEffect(() => {
    if (!worktreesQuery.data) return;
    const exists = worktreesQuery.data.some((w) => w.id === selectedWorktreeKey);
    if (!exists && selectedWorktreeKey !== MAIN_WORKTREE_ID) {
      setSelectedWorktreeByProject((prev) => ({ ...prev, [id]: MAIN_WORKTREE_ID }));
    }
  }, [id, selectedWorktreeKey, worktreesQuery.data]);
  const tasksQuery = useTasks(id, selectedWorktreeId);
  const tasks = tasksQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  useApiToken();
  const { data: entitlements } = useEntitlements();
  const { data: gitStatus } = useGitStatus(id, selectedWorktreeId, {
    enabled: projectPathReady,
  });
  const [showDiffView, setShowDiffView] = useState(false);

  const openDiffView = useCallback(() => {
    if (!projectPathReady) return;
    setShowDiffView(true);
  }, [projectPathReady]);

  const closeDiffView = useCallback(() => {
    setShowDiffView(false);
  }, []);
  useEffect(() => {
    if (!projectPathReady) setShowDiffView(false);
  }, [projectPathReady]);
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmClearFinished, setConfirmClearFinished] = useState(false);
  const [confirmClearDisconnected, setConfirmClearDisconnected] = useState(false);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [openFileRel, setOpenFileRel] = useState<string | null>(null);
  const [showLaunchConfig, setShowLaunchConfig] = useState(false);
  const [showLaunchEmpty, setShowLaunchEmpty] = useState(false);
  const [confirmDeleteWorktree, setConfirmDeleteWorktree] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [deletingWorktree, setDeletingWorktree] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [repairingProjectPath, setRepairingProjectPath] = useState(false);
  const [removingMissingProject, setRemovingMissingProject] = useState(false);
  const [retryingProjectPath, setRetryingProjectPath] = useState(false);
  const [projectPathActionError, setProjectPathActionError] = useState<string | null>(null);
  useEffect(() => {
    setProjectPathActionError(null);
  }, [projectPathCheck.state, projectPathIssue?.path]);
  const launchCommands = parseLaunchCommands(project?.launchCommands ?? null);
  const cliAvailability = useCliAvailability();

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
    runningWorktreeIds,
  } = useUserTerminals();
  const launchCommandSet = new Set(
    launchCommands.map((c) => c.command.trim()).filter(Boolean)
  );
  const hasRunningLaunch = userTerminalSessions.some(
    (s) => s.ptyId && s.terminal.startCommand && launchCommandSet.has(s.terminal.startCommand.trim())
  );
  const runningWorktreeKey = worktreesEnabled
    ? [...runningWorktreeIds].find((key) => key.startsWith(`${project?.id ?? id}:`))
    : undefined;
  const runningBlocksSelectedWorktree =
    worktreesEnabled && !!runningWorktreeKey && runningWorktreeKey !== selectedScopeKey;
  const launchPorts = useMemo(
    () => launchUrlPort(project?.launchUrl ?? null),
    [project?.launchUrl]
  );

  const stopLaunch = useCallback(async () => {
    setOverflowOpen(false);
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
    setOverflowOpen(false);
    if (!projectPathReady) return;
    if (runningBlocksSelectedWorktree) {
      const runningId = runningWorktreeKey?.split(":")[1] || MAIN_WORKTREE_ID;
      const runningName =
        worktrees.find((w) => w.id === runningId)?.name ?? runningId;
      toast.error(`Switch to ${runningName} and stop it before launching another worktree.`);
      return;
    }
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
  }, [
    runningBlocksSelectedWorktree,
    runningWorktreeKey,
    worktrees,
    launchCommands,
    launchPorts,
    killTerminalsByStartCommand,
    createTerminal,
    setPanelOpen,
    projectPathReady,
  ]);

  useEffect(() => {
    if (terminalProject) setActiveUserTerminalProject(terminalProject);
  }, [terminalProject, setActiveUserTerminalProject]);

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
  const activeTaskId = terminals.activeTaskIdFor(selectedScopeKey);
  const lastHiddenSessionRef = useRef<{ projectId: string; taskId: string } | null>(null);
  useEffect(() => {
    if (activeTaskId !== null) {
      lastActiveRef.current = { projectId: selectedScopeKey, taskId: activeTaskId };
      return;
    }
    const prev = lastActiveRef.current;
    if (!prev || prev.projectId !== selectedScopeKey || !terminalProject) return;
    const visible = tasks.filter((t) => !t.archived);
    if (visible.some((t) => t.id === prev.taskId)) return;
    lastActiveRef.current = null;
    const next = pickByPriority(visible);
    if (next) terminals.toggle(terminalProject, next);
  }, [activeTaskId, tasks, terminalProject, terminals, selectedScopeKey]);

  // Rehydrate after reload: if a persisted activeTaskId resolves to an
  // existing task for this project, materialize a session entry so the panel
  // reopens without requiring a click.
  useEffect(() => {
    if (!terminalProject) return;
    const tid = terminals.activeTaskIdFor(selectedScopeKey);
    if (!tid) return;
    const task = tasks.find((t) => t.id === tid);
    if (task) terminals.rehydrate(terminalProject, task);
  }, [terminalProject, tasks, terminals, selectedScopeKey]);

  const openRequestedSession = useCallback(
    (request: PendingSessionOpen) => {
      if (!terminalProject || request.projectId !== id) return false;
      if (!worktreesQuery.data) return false;
      if (!worktreesEnabled && request.worktreeId && request.worktreeId !== MAIN_WORKTREE_ID) {
        clearPendingSessionOpen(request);
        return false;
      }

      const requestedWorktreeKey = request.worktreeId ?? MAIN_WORKTREE_ID;
      const requestedWorktreeExists =
        requestedWorktreeKey === MAIN_WORKTREE_ID ||
        worktreesQuery.data.some((worktree) => worktree.id === requestedWorktreeKey);
      if (!requestedWorktreeExists) {
        clearPendingSessionOpen(request);
        return false;
      }

      if (requestedWorktreeKey !== selectedWorktreeKey) {
        setSelectedWorktreeByProject((prev) =>
          prev[id] === requestedWorktreeKey
            ? prev
            : { ...prev, [id]: requestedWorktreeKey },
        );
        return false;
      }

      const task = tasks.find((t) => t.id === request.taskId && !t.archived);
      if (!task) {
        if (!tasksQuery.isLoading) clearPendingSessionOpen(request);
        return false;
      }

      const active = terminals.activeFor(selectedScopeKey);
      if (active?.taskId !== task.id) {
        const activeTaskId = terminals.activeTaskIdFor(selectedScopeKey);
        if (activeTaskId === task.id) terminals.rehydrate(terminalProject, task);
        else terminals.toggle(terminalProject, task);
      }
      clearPendingSessionOpen(request);
      return true;
    },
    [
      id,
      terminalProject,
      selectedScopeKey,
      selectedWorktreeKey,
      tasks,
      tasksQuery.isLoading,
      terminals,
      worktreesEnabled,
      worktreesQuery.data,
    ],
  );

  useEffect(() => {
    const pending = readPendingSessionOpen(id);
    if (pending) openRequestedSession(pending);
  }, [id, openRequestedSession]);

  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const request = (event as CustomEvent<PendingSessionOpen>).detail;
      if (request) openRequestedSession(request);
    };
    window.addEventListener(SESSION_NOTIFICATION_OPEN_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener(SESSION_NOTIFICATION_OPEN_EVENT, onOpenRequest);
    };
  }, [openRequestedSession]);

  const invalidateProject = useCallback(
    () => {
      setProjectPathCheckRevision((value) => value + 1);
      return queryClient.invalidateQueries({ queryKey: queryKeys.project(id) });
    },
    [queryClient, id]
  );
  const invalidateTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(id, selectedWorktreeId) }),
    [queryClient, id, selectedWorktreeId]
  );
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const refresh = useCallback(async () => {
    await Promise.all([invalidateProject(), invalidateTasks(), invalidateProjects()]);
  }, [invalidateProject, invalidateTasks, invalidateProjects]);

  const invalidateWorktrees = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.worktrees(id) }),
    [queryClient, id],
  );

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

  const selectWorktree = useCallback(
    (worktreeId: string) => {
      if (!worktreesEnabled && worktreeId !== MAIN_WORKTREE_ID) return;
      setSelectedWorktreeByProject((prev) => ({ ...prev, [id]: worktreeId }));
    },
    [id, worktreesEnabled],
  );

  const createProjectWorktree = useCallback(async () => {
    if (!worktreesEnabled || !project || creatingWorktree) return;
    if (runningBlocksSelectedWorktree || runningWorktreeIds.size > 0) {
      toast.error("Stop the running worktree before creating a new setup terminal.");
      return;
    }
    setCreatingWorktree(true);
    try {
      const result = await api.createWorktree(project.id);
      await invalidateWorktrees();
      selectWorktree(result.worktree.id);
      if (result.setupCommand) {
        const setupProject = {
          ...project,
          path: result.worktree.path,
          activeWorktreeId: result.worktree.id,
        };
        await createTerminal({
          project: setupProject,
          name: `Setup: ${result.worktree.name}`,
          startCommand: result.setupCommand,
        });
      }
      toast.success(`Created worktree ${result.worktree.name}`);
    } catch (e: any) {
      toast.error(e?.message || "Could not create worktree");
    } finally {
      setCreatingWorktree(false);
    }
  }, [
    project,
    creatingWorktree,
    runningBlocksSelectedWorktree,
    runningWorktreeIds,
    invalidateWorktrees,
    selectWorktree,
    createTerminal,
    worktreesEnabled,
  ]);

  const deleteSelectedWorktree = useCallback(async () => {
    if (!worktreesEnabled || !project || !selectedWorktree || selectedWorktree.isMain) return;
    if (runningWorktreeIds.has(selectedScopeKey)) {
      toast.error("Stop this worktree before deleting it.");
      return;
    }
    setDeletingWorktree(true);
    try {
      await api.deleteWorktree(project.id, selectedWorktree.id);
      setConfirmDeleteWorktree(false);
      selectWorktree(MAIN_WORKTREE_ID);
      await Promise.all([
        invalidateWorktrees(),
        invalidateTasks(),
        queryClient.invalidateQueries({ queryKey: queryKeys.scopedUserTerminals(project.id, selectedWorktree.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
      toast.success(`Deleted worktree ${selectedWorktree.name}`);
    } catch (e: any) {
      toast.error(e?.message || "Could not delete worktree");
    } finally {
      setDeletingWorktree(false);
    }
  }, [
    project,
    selectedWorktree,
    selectedScopeKey,
    runningWorktreeIds,
    selectWorktree,
    invalidateWorktrees,
    invalidateTasks,
    queryClient,
    worktreesEnabled,
  ]);

  const [showCodexHooksNotice, setShowCodexHooksNotice] = useState(false);

  const createSession = useCallback(
    async (payload: {
      agent: Task["agent"];
      branch: string;
      skipPermissions: boolean;
      bareSession: boolean;
    }) => {
      if (!project || !terminalProject) return;
      if (!agentCanLaunch(cliAvailability, payload.agent)) {
        setShowNewAgent(true);
        return;
      }
      const isClaude = payload.agent === "claude-code";
      const created = await api.createTaskInternal(project.id, {
        title: TITLE_WAITING,
        agent: payload.agent,
        branch: payload.branch,
        claudeSessionId: isClaude ? newSessionId() : undefined,
        claudeBareSession: isClaude ? payload.bareSession : undefined,
        claudeSkipPermissions: agentSupportsSkipPermissions(payload.agent)
          ? payload.skipPermissions
          : undefined,
        worktreeId: selectedWorktreeId,
      });
      terminals.toggle(terminalProject, created.task);
      await refresh();
      if (payload.agent === "codex" && !hasSeenCodexHooksNotice()) {
        setShowCodexHooksNotice(true);
      }
    },
    [project, terminalProject, selectedWorktreeId, refresh, terminals, cliAvailability]
  );

  const startWithSaved = useCallback(async () => {
    if (!project) return;
    if (!(project.rememberAgentSettings && project.savedAgent)) return;
    if (!agentCanLaunch(cliAvailability, project.savedAgent)) {
      setShowNewAgent(true);
      return;
    }
    await createSession({
      agent: project.savedAgent,
      branch: project.branch || DEFAULT_BRANCH,
      skipPermissions: !!project.savedSkipPermissions,
      bareSession: project.savedAgent === "claude-code" ? !!project.savedBareSession : false,
    });
  }, [project, createSession, cliAvailability]);

  const onNewAgentPrimary = useCallback(() => {
    if (!projectPathReady) return;
    if (showNewAgent || showEdit) return;
    if (project?.rememberAgentSettings && project.savedAgent) {
      void startWithSaved();
      return;
    }
    setShowNewAgent(true);
  }, [project, projectPathReady, showNewAgent, showEdit, startWithSaved]);

  useHotkey("agent.new", onNewAgentPrimary, { ignoreEditable: true });

  useHotkey("project.edit", () => {
    if (showNewAgent || projectPathIssue || projectPathCheck.state === "error") return;
    setShowEdit((v) => !v);
  });

  useHotkey(
    "project.runToggle",
    () => {
      if (showNewAgent || showEdit || confirmRemove || projectPathIssue || projectPathCheck.state === "error") return;
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
      if (openFileRel || showNewAgent || showEdit || confirmRemove || !projectPathReady) return;
      setFileFinderOpen((v) => !v);
    },
  );

  const anyBlockingDialogOpen =
    showNewAgent ||
    showEdit ||
    confirmRemove ||
    confirmDeleteWorktree ||
    fileFinderOpen ||
    openFileRel !== null ||
    showLaunchConfig ||
    showLaunchEmpty ||
    !!projectPathIssue ||
    projectPathCheck.state === "error" ||
    showCodexHooksNotice;

  const cycleSession = useCallback(
    (direction: 1 | -1) => {
      if (!project || !terminalProject) return;
      if (anyBlockingDialogOpen) return;
      const visible = tasks.filter((t) => !t.archived);
      if (visible.length === 0) return;
      const ordered: Task[] = [];
      for (const status of STATUS_DISPLAY_ORDER) {
        for (const t of visible) if (t.status === status) ordered.push(t);
      }
      if (ordered.length === 0) return;
      const currentId = terminals.activeTaskIdFor(selectedScopeKey);
      // Panel closed: open the highest-priority card instead of cycling.
      if (!currentId) {
        const firstByPriority = pickByPriority(visible);
        if (!firstByPriority) return;
        terminals.toggle(terminalProject, firstByPriority);
        return;
      }
      const idx = ordered.findIndex((t) => t.id === currentId);
      if (idx === -1) return;
      const nextIdx = (idx + direction + ordered.length) % ordered.length;
      const nextTask = ordered[nextIdx];
      if (!nextTask || nextTask.id === currentId) return;
      terminals.toggle(terminalProject, nextTask);
    },
    [project, terminalProject, selectedScopeKey, tasks, terminals, anyBlockingDialogOpen],
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
    const active = terminals.activeFor(selectedScopeKey);
    if (!active) return;
    const sourceTask = tasks.find((t) => t.id === active.taskId);
    if (!sourceTask) return;
    void createSession({
      agent: sourceTask.agent,
      branch: sourceTask.branch || project.branch || DEFAULT_BRANCH,
      skipPermissions: !!sourceTask.claudeSkipPermissions,
      bareSession: sourceTask.agent === "claude-code" ? !!sourceTask.claudeBareSession : false,
    });
  }, [project, selectedScopeKey, tasks, terminals, createSession, anyBlockingDialogOpen]);
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
        anyBlockingDialogOpen ||
        !projectPathReady
      ) return;
      if (showDiffView) closeDiffView();
      else openDiffView();
    },
    { ignoreEditable: true },
  );

  const hiddenSession = lastHiddenSessionRef.current;
  const canRestoreHiddenSession =
    !!project &&
    hiddenSession?.projectId === selectedScopeKey &&
    terminals.sessions.some(
      (s) => s.taskId === hiddenSession.taskId && worktreeScopeKey(s.project.id, s.project.activeWorktreeId) === selectedScopeKey,
    ) &&
    tasks.some((t) => t.id === hiddenSession.taskId && !t.archived);
  const closePanelEnabled =
    !anyBlockingDialogOpen && !!project
      ? terminals.activeFor(selectedScopeKey) !== null || canRestoreHiddenSession
      : false;

  // Capture phase so xterm.js (focused terminal) can't swallow the key first.
  useHotkey(
    "terminal.close",
    () => {
      if (!project) return;
      const active = terminals.activeFor(selectedScopeKey);
      if (active) {
        lastHiddenSessionRef.current = { projectId: selectedScopeKey, taskId: active.taskId };
        terminals.deselect(selectedScopeKey);
        return;
      }
      const hidden = lastHiddenSessionRef.current;
      if (!hidden || hidden.projectId !== selectedScopeKey) return;
      const sessionStillOpen = terminals.sessions.some(
        (s) => s.taskId === hidden.taskId && worktreeScopeKey(s.project.id, s.project.activeWorktreeId) === selectedScopeKey,
      );
      if (!sessionStillOpen) return;
      const task = tasks.find((t) => t.id === hidden.taskId && !t.archived);
      if (!task) return;
      if (terminalProject) terminals.toggle(terminalProject, task);
    },
    {
      enabled: closePanelEnabled,
      capture: true,
    },
  );

  useServerEvents(
    useCallback(
      (e) => {
        if (e.type.startsWith("task:")) {
          void invalidateTasks();
          void invalidateProject();
        } else if (e.type.startsWith("worktree:")) {
          void invalidateWorktrees();
          void invalidateProject();
        } else if (e.type.startsWith("project:")) {
          void invalidateProject();
          void invalidateProjects();
        }
      },
      [invalidateTasks, invalidateProject, invalidateProjects, invalidateWorktrees]
    )
  );

  if (projectQuery.isError) {
    return (
      <div style={{ flex: 1, padding: 32 }}>
        <EmptyState
          title="Could not load project"
          subtitle="Mission Control could not load this hosted project. Check your connection, then retry."
          icon="shield"
          action={
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" icon="refresh" onClick={() => void projectQuery.refetch()}>
                Retry
              </Btn>
              <Btn variant="ghost" onClick={() => router.navigate({ to: "/" })}>
                Back to projects
              </Btn>
            </div>
          }
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ flex: 1, padding: 32 }}>
        <EmptyState
          title="Loading project"
          subtitle="Fetching the hosted project, sessions, terminals, and runtime state."
          icon="sparkles"
        />
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

  const activeId = terminals.activeTaskIdFor(selectedScopeKey);
  const hostedRuntime = entitlements?.hosted.enabled ? entitlements.remoteRuntime : null;
  const pathIssueIsWorktree = projectPathIssue?.scope === "worktree";

  const toggleTerminal = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const active = terminals.activeFor(selectedScopeKey);
    if (active?.taskId === taskId) {
      lastHiddenSessionRef.current = { projectId: selectedScopeKey, taskId };
    }
    if (terminalProject) terminals.toggle(terminalProject, task);
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setCleanupStatus("Cleaning up hosted resources for this session. If the hosted environment is unavailable, cleanup will be retried.");
    try {
      await terminals.close(taskId);
      await api.deleteTask(taskId);
      await refresh();
    } finally {
      setCleanupStatus(null);
    }
  };

  const confirmRemoveProject = async () => {
    if (!project) return;
    setConfirmRemove(false);
    setCleanupStatus("Cleaning up hosted resources for this project. If the hosted environment is unavailable, cleanup will be queued for retry.");
    try {
      await terminals.closeForProject(project.id);
      await api.deleteProject(project.id);
      router.navigate({ to: "/" });
    } finally {
      setCleanupStatus(null);
    }
  };

  const repairMissingProjectPath = async () => {
    const electron = getElectron();
    if (!electron) {
      toast.error("Folder picker is not available in this runtime.");
      return;
    }
    const nextPath = await electron.browseFolder();
    if (!nextPath || !project) return;
    setRepairingProjectPath(true);
    setProjectPathActionError(null);
    try {
      await api.updateProject(project.id, { path: nextPath });
      setProjectPathCheck({ state: "checking" });
      await Promise.all([refresh(), invalidateWorktrees()]);
      toast.success("Project path updated");
    } catch (e: any) {
      const message = e?.message || "Could not update this project path";
      setProjectPathActionError(message);
      toast.error(message);
    } finally {
      setRepairingProjectPath(false);
    }
  };

  const removeMissingProject = async () => {
    if (!project) return;
    setRemovingMissingProject(true);
    setProjectPathActionError(null);
    setCleanupStatus("Removing this project from Mission Control.");
    try {
      await terminals.closeForProject(project.id);
      await api.deleteProject(project.id);
      router.navigate({ to: "/" });
    } catch (e: any) {
      const message = e?.message || "Could not remove project";
      setProjectPathActionError(message);
      toast.error(message);
    } finally {
      setCleanupStatus(null);
      setRemovingMissingProject(false);
    }
  };

  const retryProjectPathCheck = async () => {
    if (!project) return;
    setRetryingProjectPath(true);
    try {
      const { status } = await api.getProjectPathStatus(project.id, selectedWorktreeId);
      setProjectPathCheck(status.ok ? { state: "valid" } : { state: "invalid", status });
    } catch (e: any) {
      setProjectPathCheck({
        state: "error",
        message: e?.message || "Could not verify this project path.",
      });
    } finally {
      setRetryingProjectPath(false);
    }
  };

  const closePathIssue = () => {
    router.navigate({ to: "/" });
  };

  const clearFinished = async () => {
    setConfirmClearFinished(false);
    const finished = tasksByStatus.finished;
    setCleanupStatus("Cleaning up hosted resources for finished sessions.");
    try {
      await Promise.all(
        finished.map(async (t) => {
          await terminals.close(t.id).catch(() => undefined);
          await api.deleteTask(t.id).catch(() => undefined);
        })
      );
      await refresh();
    } finally {
      setCleanupStatus(null);
    }
  };

  const clearDisconnected = async () => {
    setConfirmClearDisconnected(false);
    const disconnected = tasksByStatus.disconnected;
    setCleanupStatus("Cleaning up hosted resources for disconnected sessions.");
    try {
      await Promise.all(
        disconnected.map(async (t) => {
          await terminals.close(t.id).catch(() => undefined);
          await api.deleteTask(t.id).catch(() => undefined);
        })
      );
      await refresh();
    } finally {
      setCleanupStatus(null);
    }
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
        disabled={!projectPathReady}
        disabledLabel={projectPathCheck.state === "checking" ? "Checking folder" : "Folder unavailable"}
        launchUrl={project.launchUrl ?? null}
        onStart={runLaunch}
        onOpenUrl={() =>
          project.launchUrl && window.electronAPI?.openExternal(project.launchUrl)
        }
        onStop={stopLaunch}
      />
      {worktreesEnabled && (
        <>
          <WorktreeToggleGroup
            worktrees={worktrees}
            selectedId={selectedWorktree?.id ?? MAIN_WORKTREE_ID}
            runningKeys={runningWorktreeIds}
            projectId={project.id}
            onSelect={selectWorktree}
            maxWidth="min(420px, 34vw)"
          />
          <span
            aria-hidden
            style={{
              width: 1,
              height: 24,
              background: "var(--border)",
              margin: "0 2px 0 4px",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              position: "relative",
              display: "inline-flex",
            }}
          >
            <Btn
              variant="ghost"
              icon="git-branch"
              onClick={() => void createProjectWorktree()}
              disabled={creatingWorktree}
              aria-label="Create worktree"
              title="Create worktree"
            />
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                zIndex: 2,
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "1px solid color-mix(in srgb, var(--surface-0) 88%, white)",
                background: "var(--accent)",
                color: "#fff",
                boxShadow: "0 0 7px var(--accent-glow)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: creatingWorktree ? 0.58 : 1,
                pointerEvents: "none",
              }}
            >
              <Icon name="plus" size={9} />
            </span>
          </span>
        </>
      )}
      {featureFlags.installSkillsButton && (
        <>
          <span style={{ width: 12 }} aria-hidden />
          <InstallSkillsButton projectPath={selectedWorktreePath || project.path} />
        </>
      )}
    </HeaderActions>
  );

  if (showDiffView) {
    return (
      <>
        <CursorGlow />
        {headerActions}
        <GitDiffView
          projectId={project.id}
          worktreeId={selectedWorktreeId}
          projectPath={selectedWorktreePath || project.path}
          enabled={projectPathReady}
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
        <div
          className="mc-project-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            rowGap: 10,
            flexWrap: "wrap",
            margin: "-8px -8px 32px",
            padding: "22px 24px 18px",
            position: "relative",
            isolation: "isolate",
            zIndex: 2,
          }}
        >
          <div ref={overflowRef} style={{ position: "relative", minWidth: 0, flex: "0 1 auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "6px 4px 6px 6px",
                color: "var(--text)",
                maxWidth: "100%",
                minWidth: 0,
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
            </div>
            <Btn
              onClick={() => setOverflowOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label="Project actions"
              title="Project actions"
              icon="settings"
            >
              <Icon
                name="chevron-down"
                size={12}
                style={{ color: "var(--text-dim)" }}
              />
            </Btn>
            {overflowOpen && (
              <CardFrame
                role="menu"
                solid
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  minWidth: 220,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 2,
                  boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
                  zIndex: 100,
                }}
              >
                {hasRunningLaunch ? (
                  <>
                    <HotkeyTooltip action="project.runToggle">
                      <Btn
                        variant="ghost"
                        icon="x"
                        onClick={stopLaunch}
                        disabled={stopping}
                        style={{ justifyContent: "flex-start" }}
                      >
                        {stopping ? "Stopping…" : "Stop launch"}
                      </Btn>
                    </HotkeyTooltip>
                    <MenuSeparator />
                  </>
                ) : null}
                <Btn
                  variant="ghost"
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
                  icon="folder"
                  onClick={() => {
                    setOverflowOpen(false);
                    window.electronAPI?.openPath(selectedWorktreePath || project.path);
                  }}
                  style={{ justifyContent: "flex-start" }}
                  title={selectedWorktreePath || project.path}
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
                <HotkeyTooltip action="git.diff">
                  <Btn
                    variant="ghost"
                    icon="git-branch"
                    onClick={() => {
                      setOverflowOpen(false);
                      openDiffView();
                    }}
                    disabled={!projectPathReady}
                    style={{ justifyContent: "flex-start" }}
                    title={(() => {
                      const b = gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH;
                      if (gitStatus && gitStatus.changedCount > 0) {
                        return `Branch ${b} · ${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"}`;
                      }
                      return `Branch ${b}`;
                    })()}
                  >
                    <span style={{ flex: 1, textAlign: "left" }}>
                      Review Changes
                      {gitStatus && gitStatus.changedCount > 0 && (
                        <span style={{ color: "var(--text-dim)" }}>
                          {" · "}
                          {gitStatus.changedCount} changed
                        </span>
                      )}
                    </span>
                  </Btn>
                </HotkeyTooltip>
                <MenuSeparator />
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
                {featureFlags.installSkillsButton && (
                  <InstallSkillsMenuItem
                    projectPath={selectedWorktreePath || project.path}
                    onOpen={() => setOverflowOpen(false)}
                  />
                )}
                <HotkeyTooltip action="project.edit">
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
                  </Btn>
                </HotkeyTooltip>
                <MenuSeparator />
                <Btn
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    setOverflowOpen(false);
                    setConfirmRemove(true);
                  }}
                  style={{ justifyContent: "flex-start" }}
                  title="Remove this project from Mission Control. The folder on disk is not touched."
                >
                  Remove project
                </Btn>
              </CardFrame>
            )}
          </div>
          {headerActions}
          <div
            role="group"
            aria-label="Review changes and commit"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0,
              maxWidth: 480,
              minWidth: 0,
            }}
          >
            <ProjectGitStatusButton
              branch={gitStatus?.branch ?? project.branch ?? DEFAULT_BRANCH}
              changedCount={gitStatus?.changedCount}
              onClick={openDiffView}
              disabled={!projectPathReady}
            />
            <CommitPushButton
              projectId={id}
              worktreeId={selectedWorktreeId}
              size="md"
              splitTrailing
              enabled={projectPathReady}
            />
          </div>
          <div style={{ flex: 1 }} />
          <HotkeyTooltip action="file.finder" label="Find file in project">
            <Btn
              variant="ghost"
              icon="search"
              onClick={() => setFileFinderOpen(true)}
              aria-label="Find file in project"
            />
          </HotkeyTooltip>
          {worktreesEnabled && selectedWorktree && !selectedWorktree.isMain && (
            <Btn
              variant="ghost"
              icon="trash"
              onClick={() => setConfirmDeleteWorktree(true)}
              aria-label={`Delete worktree ${selectedWorktree.name}`}
              title={`Delete worktree ${selectedWorktree.name}`}
            />
          )}
        </div>

        {hostedRuntime && !hostedRuntime.allowed && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              margin: "0 12px 28px",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-1)",
              color: "var(--text-dim)",
              fontSize: 12,
              fontFamily: "var(--mono)",
            }}
          >
            Remote terminals and agents are unavailable until Academy grants hosted runtime for this account
            or the compute usage window resets.
          </div>
        )}
        {cleanupStatus && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              margin: "0 12px 28px",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-1)",
              color: "var(--text-dim)",
              fontSize: 12,
              fontFamily: "var(--mono)",
            }}
          >
            {cleanupStatus}
          </div>
        )}

        {visibleTasks.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 34,
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
                disabled={!projectPathReady}
                onConfigure={() => {
                  if (projectPathReady) setShowNewAgent(true);
                }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 48,
            paddingInline: 12,
            boxSizing: "border-box",
          }}
        >
          {tasksQuery.isLoading && (
            <EmptyState
              title="Loading sessions"
              subtitle="Fetching the hosted task list and terminal state."
              icon="sparkles"
            />
          )}
          {tasksQuery.isError && (
            <EmptyState
              title="Could not load sessions"
              subtitle="Mission Control could not load sessions for this project. Retry before starting new work."
              icon="shield"
              action={
                <Btn variant="primary" icon="refresh" onClick={() => void tasksQuery.refetch()}>
                  Retry
                </Btn>
              }
            />
          )}
          {!tasksQuery.isLoading && !tasksQuery.isError && STATUS_DISPLAY_ORDER.filter((s) => tasksByStatus[s].length > 0).map((status) => (
            <TaskColumn
              key={status}
              title={STATUS_META[status].label}
              color={STATUS_META[status].color}
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
                    Clear all
                  </Btn>
                ) : status === "disconnected" && tasksByStatus.disconnected.length > 0 ? (
                  <Btn
                    variant="ghost"
                    icon="trash"
                    onClick={() => setConfirmClearDisconnected(true)}
                    title="Remove all disconnected sessions"
                  >
                    Clear all
                  </Btn>
                ) : undefined
              }
            />
          ))}
          {!tasksQuery.isLoading && !tasksQuery.isError && visibleTasks.length === 0 && (
            <EmptyState
              title="No active sessions"
              subtitle={
                hostedRuntime
                  ? "Start a cloud-backed agent session when you are ready to work on this hosted project."
                  : "Start a new session to begin working on this project."
              }
              action={
                <NewAgentButton
                  project={project}
                  onPrimary={onNewAgentPrimary}
                  disabled={!projectPathReady}
                  onConfigure={() => {
                    if (projectPathReady) setShowNewAgent(true);
                  }}
                />
              }
            />
          )}
        </div>
      </CardFrame>

      <CodexHooksNoticeDialog
        open={showCodexHooksNotice}
        onClose={() => {
          setShowCodexHooksNotice(false);
          markCodexHooksNoticeSeen();
        }}
      />

      <Modal
        open={!!projectPathIssue}
        onClose={closePathIssue}
        title={pathIssueIsWorktree ? "Worktree folder missing" : "Project folder missing"}
        width={540}
        footer={
          <>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn
                variant="ghost"
                onClick={closePathIssue}
              >
                Back to projects
              </Btn>
            </StaticHotkeyTooltip>
            {pathIssueIsWorktree ? (
              <>
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => void deleteSelectedWorktree()}
                  disabled={deletingWorktree}
                >
                  {deletingWorktree ? "Deleting..." : "Delete worktree"}
                </Btn>
                <Btn
                  variant="primary"
                  icon="folder"
                  onClick={() => selectWorktree(MAIN_WORKTREE_ID)}
                  disabled={deletingWorktree}
                >
                  Switch to main
                </Btn>
              </>
            ) : (
              <>
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => void removeMissingProject()}
                  disabled={repairingProjectPath || removingMissingProject}
                >
                  {removingMissingProject ? "Removing..." : "Remove project"}
                </Btn>
                <Btn
                  variant="primary"
                  icon="folder"
                  onClick={() => void repairMissingProjectPath()}
                  disabled={repairingProjectPath || removingMissingProject}
                >
                  {repairingProjectPath ? "Updating..." : "Choose new folder"}
                </Btn>
              </>
            )}
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
            {projectPathIssue?.message ?? "Mission Control cannot find this project folder."}
            {" "}
            {pathIssueIsWorktree
              ? "Switch back to the main project folder, or delete this missing worktree."
              : "Choose the folder in its new location, or remove the project from Mission Control."}
          </div>
          {projectPathActionError && (
            <div
              style={{
                border: "1px solid color-mix(in srgb, var(--status-failed) 55%, transparent)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--status-failed) 12%, transparent)",
                color: "var(--status-failed)",
                padding: "9px 11px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.45,
              }}
            >
              {projectPathActionError}
            </div>
          )}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface-0)",
              padding: "10px 12px",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text-dim)",
              lineHeight: 1.45,
              wordBreak: "break-all",
            }}
          >
            {projectPathIssue?.path}
          </div>
        </div>
      </Modal>

      <Modal
        open={projectPathCheck.state === "error"}
        onClose={closePathIssue}
        title="Could not check project folder"
        width={500}
        footer={
          <>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn variant="ghost" onClick={closePathIssue}>
                Back to projects
              </Btn>
            </StaticHotkeyTooltip>
            <Btn
              variant="primary"
              icon="refresh"
              onClick={() => void retryProjectPathCheck()}
              disabled={retryingProjectPath}
            >
              {retryingProjectPath ? "Checking..." : "Retry"}
            </Btn>
          </>
        }
      >
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
          {projectPathCheck.state === "error"
            ? projectPathCheck.message
            : "Mission Control could not verify this project path."}
        </div>
      </Modal>

      <NewAgentDialog
        open={showNewAgent}
        project={project}
        onClose={() => setShowNewAgent(false)}
        onStart={startAgent}
        onPersistRemember={async (patch) => {
          const previous = queryClient.getQueryData<typeof project>(queryKeys.project(project.id));
          queryClient.setQueryData(queryKeys.project(project.id), (prev: typeof project | undefined) =>
            prev ? { ...prev, ...patch } : prev
          );
          try {
            await api.updateProject(project.id, patch);
            await refresh();
          } catch (error) {
            queryClient.setQueryData(queryKeys.project(project.id), previous);
            throw error;
          }
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
        projectRoot={selectedWorktreePath || project.path}
        onClose={() => setFileFinderOpen(false)}
        onPick={(rel) => setOpenFileRel(rel)}
      />

      <FileEditorDialog
        projectRoot={selectedWorktreePath || project.path}
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

      {selectedWorktree && !selectedWorktree.isMain && (
        <ConfirmDialog
          open={confirmDeleteWorktree}
          onClose={() => setConfirmDeleteWorktree(false)}
          onConfirm={deleteSelectedWorktree}
          title="Delete worktree"
          confirmLabel="Delete"
          icon="trash"
          loading={deletingWorktree}
          width={500}
        >
          <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
            Delete worktree &ldquo;{selectedWorktree.name}&rdquo;?
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Mission Control will remove the worktree directory at {selectedWorktree.path}. The
            branch is kept. If this worktree has uncommitted changes, deletion will be blocked.
          </div>
        </ConfirmDialog>
      )}

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
        confirmLabel="Clear all"
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

      <ConfirmDialog
        open={confirmClearDisconnected}
        onClose={() => setConfirmClearDisconnected(false)}
        onConfirm={clearDisconnected}
        title="Clear disconnected sessions"
        confirmLabel="Clear all"
        icon="trash"
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Remove all disconnected sessions in &ldquo;{project.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {tasksByStatus.disconnected.length} disconnected session{tasksByStatus.disconnected.length === 1 ? "" : "s"} will be deleted. Other sessions are unaffected.
        </div>
      </ConfirmDialog>
      </div>
    </>
  );
}

function WorktreeToggleGroup({
  worktrees,
  selectedId,
  runningKeys,
  projectId,
  onSelect,
  maxWidth = 420,
}: {
  worktrees: WorktreeInfo[];
  selectedId: string;
  runningKeys: ReadonlySet<string>;
  projectId: string;
  onSelect: (id: string) => void;
  maxWidth?: number | string;
}) {
  const items = worktrees.length > 0 ? worktrees : [];
  if (items.length === 0) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Project worktrees"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth,
        overflowX: "auto",
        padding: 2,
        flexShrink: 1,
      }}
    >
      {items.map((worktree) => {
        const selected = worktree.id === selectedId;
        const running = runningKeys.has(worktreeScopeKey(projectId, worktree.isMain ? null : worktree.id));
        return (
          <button
            key={worktree.id}
            type="button"
            role="radio"
            onClick={() => onSelect(worktree.id)}
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
              const currentIndex = items.findIndex((item) => item.id === worktree.id);
              const next = items[(currentIndex + direction + items.length) % items.length];
              if (next) onSelect(next.id);
            }}
            aria-label={`Switch to worktree ${worktree.name}`}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            title={worktree.path}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              height: 28,
              padding: "0 10px",
              borderRadius: 999,
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              background: selected ? "var(--accent-faint)" : "var(--surface-0)",
              color: selected ? "var(--accent)" : "var(--text-dim)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            {running && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: -4,
                  left: "50%",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  transform: "translateX(-50%)",
                  boxShadow: "0 0 6px var(--accent-glow)",
                }}
              />
            )}
            {worktree.name}
          </button>
        );
      })}
    </div>
  );
}

function ProjectGitStatusButton({
  branch,
  changedCount,
  onClick,
  disabled = false,
}: {
  branch: string;
  changedCount: number | undefined;
  onClick: () => void;
  disabled?: boolean;
}) {
  const changedLabel =
    disabled
      ? "Unavailable"
      : changedCount === undefined
      ? "Checking…"
      : `${changedCount} ${changedCount === 1 ? "Change" : "Changes"}`;
  const title =
    disabled
      ? "Review Changes unavailable until the project folder is valid"
      : changedCount === undefined
      ? `Open Review Changes · branch ${branch}`
      : `Open Review Changes · ${changedCount} changed file${changedCount === 1 ? "" : "s"} · branch ${branch}`;

  return (
    <HotkeyTooltip action="git.diff" label={title}>
      <Btn
        variant="ghost"
        icon="git-branch"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="mc-btn-attached-right"
        style={{ fontFamily: "var(--mono)", maxWidth: 320, minWidth: 0 }}
      >
        <span
          style={{
            color: changedCount && changedCount > 0 ? "var(--accent)" : "var(--text-dim)",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {changedLabel}
        </span>
      </Btn>
    </HotkeyTooltip>
  );
}

function RunStatusPill({
  running,
  launching,
  stopping,
  disabled = false,
  disabledLabel = "Unavailable",
  launchUrl,
  onStart,
  onOpenUrl,
  onStop,
}: {
  running: boolean;
  launching: boolean;
  stopping: boolean;
  disabled?: boolean;
  disabledLabel?: string;
  launchUrl: string | null;
  onStart: () => void;
  onOpenUrl: () => void;
  onStop: () => void;
}) {
  const busy = launching || stopping;
  const label = disabled
    ? disabledLabel
    : stopping
    ? "Stopping…"
    : launching
      ? "Starting…"
      : running
        ? "Running"
        : "Offline";

  const interactive = !disabled && !busy && !running;
  const onClick = disabled || busy ? undefined : running ? undefined : onStart;

  const title = disabled
    ? disabledLabel
    : busy
    ? label
    : running
      ? "Running"
      : "Run launch commands";

  const tone = !disabled && (running || launching) ? "active" : "idle";
  const dotColor = tone === "active" ? "var(--accent)" : "var(--text-faint)";
  const borderColor = tone === "active" ? "var(--accent-border)" : "var(--border)";
  const background = tone === "active" ? "var(--accent-faint)" : "var(--surface-0)";
  const fg = tone === "active" ? "var(--accent)" : "var(--text-dim)";

  const activeFrameIconStyle: CSSProperties = {
    minWidth: 52,
    paddingInline: 0,
    fontFamily: "var(--mono)",
  };

  const showRunningSplit = running && !busy;

  if (showRunningSplit) {
    return (
      <div
        role="group"
        aria-label="Project launch — running"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {launchUrl ? (
          <Btn
            variant="ghost"
            icon="external-link"
            onClick={onOpenUrl}
            title={`Open ${launchUrl} in browser`}
            aria-label={`Open ${launchUrl} in browser`}
          >
            Open
          </Btn>
        ) : null}
        <HotkeyTooltip action="project.runToggle" label="Stop launch commands">
          <Btn
            variant="danger"
            icon="stop"
            onClick={() => onStop()}
            aria-label="Stop launch commands"
          >
            Stop
          </Btn>
        </HotkeyTooltip>
      </div>
    );
  }

  const showOfflineSplit = !disabled && !running && !busy;

  if (showOfflineSplit) {
    return (
      <HotkeyTooltip action="project.runToggle" label={title}>
        <Btn
          variant="ghost"
          icon="play"
          onClick={onStart}
          aria-label={title}
          style={{ fontFamily: "var(--mono)" }}
        />
      </HotkeyTooltip>
    );
  }

  return (
    <HotkeyTooltip action="project.runToggle" label={title}>
      <button
        type="button"
        onClick={onClick}
        disabled={!interactive}
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
          opacity: busy || disabled ? 0.7 : 1,
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
      </button>
    </HotkeyTooltip>
  );
}
