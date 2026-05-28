import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
import { AgentUpdateRequiredDialog } from "~/components/views/AgentUpdateRequiredDialog";
import { ProjectDialog } from "~/components/views/ProjectDialog";
import { FileFinderDialog } from "~/components/views/FileFinderDialog";
import { FileEditorDialog } from "~/components/views/FileEditorDialog";
import { LaunchCommandsDialog } from "~/components/views/LaunchCommandsDialog";
import { WorktreeSetupCommandDialog } from "~/components/views/WorktreeSetupCommandDialog";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { Modal } from "~/components/ui/Modal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { api, type AppSettings } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { newSessionId } from "~/lib/claude-command";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import {
  appendOptimisticTask,
  buildOptimisticTask,
  removeOptimisticTask,
  removeTaskFromCache,
  removeTasksFromCache,
  replaceOptimisticTask,
  restoreTasksCache,
} from "~/lib/optimistic-task";
import { prefetchTerminalModules } from "~/lib/prefetch-terminal-modules";
import { newClientId } from "~/shared/client-id";
import {
  defaultSessionPayload,
  discardSessionWarmSlot,
  persistWarmSlotTask,
  prepareSessionWarmSlot,
  replenishSessionWarmSlot,
  sessionCreateSignature,
  takeSessionWarmSlot,
  type SessionCreatePayload,
} from "~/lib/session-warm-pool";
import { useServerEvents } from "~/lib/use-events";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  hostedCleanupStatusForCurrentRuntime,
  type HostedCleanupStatusScope,
} from "~/lib/hosted-cleanup-status";
import { DEFAULT_BRANCH, parseLaunchCommands, STATUS_DISPLAY_ORDER, TASK_STATUSES } from "~/shared/domain";
import { hasRunningLaunchSessions } from "~/lib/project-launch-running";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import {
  queryKeys,
  useApiToken,
  useEntitlements,
  useGroups,
  useProject,
  useSettings,
  useTasks,
  useWorktrees,
} from "~/queries";
import { useWorktreesEnabled } from "~/lib/use-worktrees-enabled";
import { useGitStatus } from "~/queries/git";
import { GitDiffView } from "~/components/views/GitDiffView";
import { CommitPushButton } from "~/components/views/CommitPushButton";
import { BranchTypeahead } from "~/components/views/BranchTypeahead";
import {
  CreatePullRequestDialog,
  CreatePullRequestMenuItem,
  useCreatePullRequestAction,
} from "~/components/views/CreatePullRequestButton";
import { HeaderActions } from "~/components/ui/HeaderActionsSlot";
import { InstallDiagramSkillMenuItem } from "~/components/views/InstallDiagramSkillMenuItem";
import { InstallDiagramSkillModal } from "~/components/views/InstallDiagramSkillModal";
import {
  availabilityFor,
  type CliAvailability,
  useCliAvailability,
} from "~/lib/cli-availability";
import {
  SESSION_NOTIFICATION_OPEN_EVENT,
  clearPendingSessionOpen,
  readPendingSessionOpen,
  type PendingSessionOpen,
} from "~/lib/session-notification-store";
import type { Group, Task, TaskStatus } from "~/db/schema";
import type { ProjectPathStatus } from "~/shared/projects";
import type { WorktreeInfo } from "~/shared/worktrees";
import { MAIN_WORKTREE_ID, worktreeScopeKey } from "~/shared/worktrees";
import {
  readCachedSelectedWorktreeByProject,
  writeCachedSelectedWorktreeByProject,
} from "~/lib/ui-preference-cache";
import {
  selectedWorktreeMapsEqual,
  type SelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import {
  DUPLICATE_ACTIVE_SESSION_EVENT,
  pickByPriority,
  STATUS_META,
} from "~/lib/design-meta";
import { useSyncProjectDiagrams } from "~/lib/use-diagram-events";
import { useGitDiffViewOpen } from "~/lib/git-diff-view-store";

export const Route = createFileRoute("/projects/$id")({
  component: ProjectPage,
});

type ProjectPathCheck =
  | { state: "idle" | "checking" | "valid" }
  | { state: "invalid"; status: Extract<ProjectPathStatus, { ok: false }> }
  | { state: "error"; message: string };

const OPTIMISTIC_WORKTREE_ID_PREFIX = "wt-optimistic-";

function isOptimisticWorktree(worktree: WorktreeInfo): boolean {
  return worktree.id.startsWith(OPTIMISTIC_WORKTREE_ID_PREFIX);
}

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
      className="mc-project-actions-menu-separator"
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
  const { data: settings } = useSettings();
  const settingsLoaded = settings !== undefined;
  const storedSelectedWorktreeByProject = settings?.selectedWorktreeByProject ?? null;
  const [selectedWorktreeByProject, setSelectedWorktreeByProject] =
    useState<SelectedWorktreeByProject>(() => {
      return readCachedSelectedWorktreeByProject() ?? {};
    });
  const [worktreeSelectionHydrated, setWorktreeSelectionHydrated] = useState(false);
  const selectedWorktreeByProjectRef = useRef(selectedWorktreeByProject);
  const syncingStoredWorktreeSelectionRef = useRef(false);
  useEffect(() => {
    selectedWorktreeByProjectRef.current = selectedWorktreeByProject;
  }, [selectedWorktreeByProject]);
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!storedSelectedWorktreeByProject) {
      syncingStoredWorktreeSelectionRef.current = false;
      setWorktreeSelectionHydrated(true);
      return;
    }
    syncingStoredWorktreeSelectionRef.current = !selectedWorktreeMapsEqual(
      selectedWorktreeByProjectRef.current,
      storedSelectedWorktreeByProject,
    );
    setSelectedWorktreeByProject((current) =>
      selectedWorktreeMapsEqual(current, storedSelectedWorktreeByProject)
        ? current
        : storedSelectedWorktreeByProject,
    );
    setWorktreeSelectionHydrated(true);
  }, [settingsLoaded, storedSelectedWorktreeByProject]);
  useEffect(() => {
    writeCachedSelectedWorktreeByProject(selectedWorktreeByProject);
    if (!settingsLoaded) return;
    if (!worktreeSelectionHydrated) return;
    if (syncingStoredWorktreeSelectionRef.current) {
      if (
        selectedWorktreeMapsEqual(
          storedSelectedWorktreeByProject,
          selectedWorktreeByProject,
        )
      ) {
        syncingStoredWorktreeSelectionRef.current = false;
      } else {
        return;
      }
    }
    if (
      selectedWorktreeMapsEqual(
        storedSelectedWorktreeByProject,
        selectedWorktreeByProject,
      )
    ) {
      return;
    }
    if (
      !storedSelectedWorktreeByProject &&
      Object.keys(selectedWorktreeByProject).length === 0
    ) {
      return;
    }
    queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
      current
        ? { ...current, selectedWorktreeByProject }
        : current,
    );
    void api
      .updateSettings({ selectedWorktreeByProject })
      .then((next) => queryClient.setQueryData(queryKeys.settings, next))
      .catch((error) => {
        console.error("[settings] failed to persist selected worktree:", error);
      });
  }, [
    queryClient,
    selectedWorktreeByProject,
    settingsLoaded,
    storedSelectedWorktreeByProject,
    worktreeSelectionHydrated,
  ]);
  const projectQuery = useProject(id);
  useSyncProjectDiagrams(id);
  const worktreesQuery = useWorktrees(id);
  const groupsQuery = useGroups();
  const project = projectQuery.data;
  const worktreesEnabled = useWorktreesEnabled();
  const worktrees = worktreesQuery.data ?? [];
  const selectedWorktreeKey = worktreesEnabled
    ? selectedWorktreeByProject[id] || MAIN_WORKTREE_ID
    : MAIN_WORKTREE_ID;
  const selectedWorktreeKeyRef = useRef(selectedWorktreeKey);
  useEffect(() => {
    selectedWorktreeKeyRef.current = selectedWorktreeKey;
  }, [selectedWorktreeKey]);
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
  const pathScopeKey = `${project?.id ?? ""}:${project?.path ?? ""}:${selectedWorktreeId ?? ""}:${selectedWorktreePath}`;
  const pathScopeRef = useRef(pathScopeKey);
  useEffect(() => {
    if (!project) {
      setProjectPathCheck({ state: "idle" });
      pathScopeRef.current = pathScopeKey;
      return;
    }
    const scopeChanged = pathScopeRef.current !== pathScopeKey;
    pathScopeRef.current = pathScopeKey;
    let cancelled = false;
    // Keep the last-known-good path while revalidating the same scope so git
    // status and launch controls don't flicker on unrelated cache refreshes
    // (e.g. deleting a session only touches tasks, not the worktree path).
    setProjectPathCheck((prev) => {
      if (scopeChanged || prev.state === "idle") return { state: "checking" };
      if (prev.state === "valid") return prev;
      return { state: "checking" };
    });
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
  }, [pathScopeKey, project, selectedWorktreeId]);
  const projectPathReady = projectPathCheck.state === "valid";
  const projectPathBlocked =
    projectPathCheck.state === "invalid" || projectPathCheck.state === "error";
  const projectPathUsable = projectPathReady || projectPathCheck.state === "checking";
  const projectPathIssue =
    projectPathCheck.state === "invalid" ? projectPathCheck.status : null;
  const terminalProject = projectPathReady ? scopedProject : null;
  const defaultWarmPayload = useMemo(
    () => (project ? defaultSessionPayload(project) : null),
    [
      project?.branch,
      project?.rememberAgentSettings,
      project?.savedAgent,
      project?.savedSkipPermissions,
      project?.savedBareSession,
    ],
  );
  const warmPrepareKey =
    terminalProject && defaultWarmPayload
      ? `${terminalProject.id}:${terminalProject.path}:${sessionCreateSignature(defaultWarmPayload, terminalProject.path)}`
      : null;
  useEffect(() => {
    if (!terminalProject || !defaultWarmPayload || !warmPrepareKey) return;
    void prefetchTerminalModules();
    void prepareSessionWarmSlot({ project: terminalProject, payload: defaultWarmPayload });
    return () => {
      void discardSessionWarmSlot();
    };
  }, [warmPrepareKey, terminalProject, defaultWarmPayload]);

  const prepareWarmForDialog = useCallback(
    (payload: SessionCreatePayload) => {
      if (!terminalProject) return;
      void prepareSessionWarmSlot({ project: terminalProject, payload });
    },
    [terminalProject],
  );
  useEffect(() => {
    if (!worktreesQuery.data) return;
    const exists = worktreesQuery.data.some((w) => w.id === selectedWorktreeKey);
    if (!exists && selectedWorktreeKey !== MAIN_WORKTREE_ID) {
      setSelectedWorktreeByProject((prev) =>
        prev[id] === MAIN_WORKTREE_ID ? prev : { ...prev, [id]: MAIN_WORKTREE_ID }
      );
    }
  }, [id, selectedWorktreeKey, worktreesQuery.data]);
  const tasksQuery = useTasks(id, selectedWorktreeId);
  const tasks = tasksQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  useApiToken();
  const { data: entitlements } = useEntitlements();
  const { data: gitStatus } = useGitStatus(id, selectedWorktreeId, {
    enabled: projectPathUsable,
  });
  const createPullRequest = useCreatePullRequestAction({
    projectId: id,
    worktreeId: selectedWorktreeId,
    branch: gitStatus?.branch,
    projectPathUsable,
  });
  const { open: showDiffView, toggle: toggleDiffView, close: closeDiffView } =
    useGitDiffViewOpen(id);
  const onToggleDiffView = useCallback(() => {
    if (!projectPathReady) return;
    toggleDiffView();
  }, [projectPathReady, toggleDiffView]);
  useEffect(() => {
    if (projectPathBlocked) closeDiffView();
  }, [projectPathBlocked, closeDiffView]);
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmClearFinished, setConfirmClearFinished] = useState(false);
  const [confirmClearDisconnected, setConfirmClearDisconnected] = useState(false);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [openFileRel, setOpenFileRel] = useState<string | null>(null);
  const [showLaunchConfig, setShowLaunchConfig] = useState(false);
  const [showWorktreeSetupConfig, setShowWorktreeSetupConfig] = useState(false);
  const [showInstallDiagramSkill, setShowInstallDiagramSkill] = useState(false);
  const [showLaunchEmpty, setShowLaunchEmpty] = useState(false);
  const [confirmDeleteWorktree, setConfirmDeleteWorktree] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const creatingWorktreeRef = useRef(false);
  const [deletingWorktree, setDeletingWorktree] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [repairingProjectPath, setRepairingProjectPath] = useState(false);
  const [removingMissingProject, setRemovingMissingProject] = useState(false);
  const [retryingProjectPath, setRetryingProjectPath] = useState(false);
  const [projectPathActionError, setProjectPathActionError] = useState<string | null>(null);
  const showHostedCleanupStatus = (scope: HostedCleanupStatusScope) => {
    const status = hostedCleanupStatusForCurrentRuntime(scope);
    if (status) setCleanupStatus(status);
  };
  useEffect(() => {
    setProjectPathActionError(null);
  }, [projectPathCheck.state, projectPathIssue?.path]);
  const launchCommands = parseLaunchCommands(project?.launchCommands ?? null);
  const launchCommandSet = useMemo(
    () =>
      new Set(launchCommands.map((c) => c.command.trim()).filter(Boolean)),
    [launchCommands]
  );
  const cliAvailability = useCliAvailability();

  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowMenuRect, setOverflowMenuRect] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const overflowDropdownRef = useRef<HTMLElement>(null);
  const updateOverflowMenuRect = useCallback(() => {
    const anchor = overflowRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setOverflowMenuRect({
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: 220,
    });
  }, []);
  useLayoutEffect(() => {
    if (!overflowOpen) {
      setOverflowMenuRect(null);
      return;
    }
    updateOverflowMenuRect();
    window.addEventListener("resize", updateOverflowMenuRect);
    window.addEventListener("scroll", updateOverflowMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateOverflowMenuRect);
      window.removeEventListener("scroll", updateOverflowMenuRect, true);
    };
  }, [overflowOpen, updateOverflowMenuRect]);
  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (overflowRef.current?.contains(target)) return;
      if (overflowDropdownRef.current?.contains(target)) return;
      setOverflowOpen(false);
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
  const syncTask = terminals.syncTask;
  const rehydrateTerminal = terminals.rehydrate;
  const toggleTerminalSession = terminals.toggle;
  const {
    setProject: setActiveUserTerminalProject,
    createTerminal,
    killTerminalsByStartCommand,
    setPanelOpen,
    sessions: userTerminalSessions,
    runningLaunchWorktreeIdsForProject,
  } = useUserTerminals();
  const launchRunningWorktreeIds = useMemo(
    () => runningLaunchWorktreeIdsForProject(project?.id ?? id, project?.launchCommands ?? null),
    [id, project?.id, project?.launchCommands, runningLaunchWorktreeIdsForProject]
  );
  const hasRunningLaunch = hasRunningLaunchSessions(userTerminalSessions, launchCommandSet);
  const runningWorktreeKey = worktreesEnabled
    ? [...launchRunningWorktreeIds].find((key) => key.startsWith(`${project?.id ?? id}:`))
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
    for (const task of tasks) syncTask(task);
  }, [tasks, syncTask]);

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
    if (next) toggleTerminalSession(terminalProject, next);
  }, [activeTaskId, tasks, terminalProject, toggleTerminalSession, selectedScopeKey]);

  // Rehydrate after reload: if a persisted activeTaskId resolves to an
  // existing task for this project, materialize a session entry so the panel
  // reopens without requiring a click.
  useEffect(() => {
    if (!terminalProject) return;
    if (!activeTaskId) return;
    const task = tasks.find((t) => t.id === activeTaskId);
    if (task) rehydrateTerminal(terminalProject, task);
  }, [activeTaskId, terminalProject, tasks, rehydrateTerminal]);

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
    () => queryClient.invalidateQueries({ queryKey: queryKeys.project(id) }),
    [queryClient, id],
  );
  const invalidateTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(id, selectedWorktreeId) }),
    [queryClient, id, selectedWorktreeId]
  );
  const invalidateProjects = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    [queryClient]
  );
  const invalidateGroups = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    [queryClient],
  );
  const createGroupForSelection = useCallback(
    async (name: string) => {
      const { group } = await api.createGroup({ name });
      queryClient.setQueryData<Group[]>(queryKeys.groups, (current) =>
        current ? [...current, group] : [group],
      );
      await invalidateGroups();
      return group;
    },
    [invalidateGroups, queryClient],
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
      selectedWorktreeKeyRef.current = worktreeId;
      setSelectedWorktreeByProject((prev) =>
        prev[id] === worktreeId ? prev : { ...prev, [id]: worktreeId }
      );
    },
    [id, worktreesEnabled],
  );

  const createProjectWorktree = useCallback(async () => {
    if (!worktreesEnabled || !project || creatingWorktreeRef.current) return;
    creatingWorktreeRef.current = true;
    setCreatingWorktree(true);
    const worktreesKey = queryKeys.worktrees(project.id);
    const selectionAtCreate = selectedWorktreeKeyRef.current;
    const optimisticWorktree: WorktreeInfo = {
      id: `${OPTIMISTIC_WORKTREE_ID_PREFIX}${Date.now()}`,
      projectId: project.id,
      name: "Creating...",
      path: project.path,
      branch: "",
      isMain: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await queryClient.cancelQueries({ queryKey: worktreesKey });
    queryClient.setQueryData<WorktreeInfo[]>(worktreesKey, (current) =>
      current ? [...current, optimisticWorktree] : current
    );
    try {
      const result = await api.createWorktree(project.id);
      queryClient.setQueryData<WorktreeInfo[]>(worktreesKey, (current) => {
        const withoutOptimistic = (current ?? []).filter(
          (worktree) =>
            worktree.id !== optimisticWorktree.id && worktree.id !== result.worktree.id
        );
        return [...withoutOptimistic, result.worktree];
      });
      await invalidateWorktrees();
      if (selectedWorktreeKeyRef.current === selectionAtCreate) {
        selectWorktree(result.worktree.id);
      }
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
      queryClient.setQueryData<WorktreeInfo[]>(worktreesKey, (current) =>
        current?.filter((worktree) => worktree.id !== optimisticWorktree.id) ?? current
      );
      void invalidateWorktrees();
      toast.error(e?.message || "Could not create worktree");
    } finally {
      creatingWorktreeRef.current = false;
      setCreatingWorktree(false);
    }
  }, [
    project,
    invalidateWorktrees,
    selectWorktree,
    createTerminal,
    queryClient,
    worktreesEnabled,
  ]);

  const deleteSelectedWorktree = useCallback(async () => {
    if (!worktreesEnabled || !project || !selectedWorktree || selectedWorktree.isMain) return;
    if (launchRunningWorktreeIds.has(selectedScopeKey)) {
      toast.error("Stop this worktree before deleting it.");
      return;
    }
    setDeletingWorktree(true);
    const worktreesKey = queryKeys.worktrees(project.id);
    const previousWorktrees = queryClient.getQueryData<WorktreeInfo[]>(worktreesKey);
    const previousSelectedWorktreeKey = selectedWorktreeKey;
    await queryClient.cancelQueries({ queryKey: worktreesKey });
    setConfirmDeleteWorktree(false);
    selectWorktree(MAIN_WORKTREE_ID);
    queryClient.setQueryData<WorktreeInfo[]>(worktreesKey, (current) =>
      current?.filter((worktree) => worktree.id !== selectedWorktree.id) ?? current
    );
    try {
      await api.deleteWorktree(project.id, selectedWorktree.id);
      await Promise.all([
        invalidateWorktrees(),
        invalidateTasks(),
        queryClient.invalidateQueries({ queryKey: queryKeys.scopedUserTerminals(project.id, selectedWorktree.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
      toast.success(`Deleted worktree ${selectedWorktree.name}`);
    } catch (e: any) {
      if (previousWorktrees) {
        queryClient.setQueryData(worktreesKey, previousWorktrees);
      } else {
        void invalidateWorktrees();
      }
      selectWorktree(previousSelectedWorktreeKey);
      setConfirmDeleteWorktree(true);
      toast.error(e?.message || "Could not delete worktree");
    } finally {
      setDeletingWorktree(false);
    }
  }, [
    project,
    selectedWorktree,
    selectedWorktreeKey,
    selectedScopeKey,
    launchRunningWorktreeIds,
    selectWorktree,
    invalidateWorktrees,
    invalidateTasks,
    queryClient,
    worktreesEnabled,
  ]);

  const [showCodexHooksNotice, setShowCodexHooksNotice] = useState(false);
  const [agentUpdateRequired, setAgentUpdateRequired] = useState<{
    agent: Task["agent"];
    availability: CliAvailability;
  } | null>(null);

  const showAgentUpdateRequired = useCallback(
    (agent: Task["agent"], availability?: CliAvailability) => {
      setShowNewAgent(false);
      setAgentUpdateRequired({
        agent,
        availability: availability ?? availabilityFor(cliAvailability, agent),
      });
    },
    [cliAvailability],
  );

  const createSession = useCallback(
    (payload: SessionCreatePayload) => {
      if (!project || !terminalProject) return;
      const selectedAvailability = availabilityFor(cliAvailability, payload.agent);
      if (selectedAvailability.status === "outdated") {
        showAgentUpdateRequired(payload.agent, selectedAvailability);
        return;
      }
      if (selectedAvailability.status === "missing") {
        setShowNewAgent(true);
        return;
      }

      const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId);
      void queryClient.cancelQueries({ queryKey: tasksKey });

      const warmSlot = takeSessionWarmSlot(payload, terminalProject.path);
      if (warmSlot) {
        appendOptimisticTask(queryClient, project.id, selectedWorktreeId, warmSlot.draftTask);
        terminals.openSession(terminalProject, warmSlot.draftTask, { ptyId: warmSlot.ptyId });
        void (async () => {
          try {
            const task = await persistWarmSlotTask(project.id, warmSlot, selectedWorktreeId);
            replaceOptimisticTask(
              queryClient,
              project.id,
              selectedWorktreeId,
              warmSlot.clientTaskId,
              task,
            );
            terminals.openSession(terminalProject, task, { ptyId: warmSlot.ptyId });
            void Promise.all([invalidateProject(), invalidateTasks(), invalidateProjects()]);
            replenishSessionWarmSlot({
              project: terminalProject,
              payload: defaultSessionPayload(project),
            });
            if (payload.agent === "codex" && !hasSeenCodexHooksNotice()) {
              setShowCodexHooksNotice(true);
            }
          } catch (e: unknown) {
            removeOptimisticTask(queryClient, project.id, selectedWorktreeId, warmSlot.clientTaskId);
            await terminals.close(warmSlot.clientTaskId);
            toast.error(e instanceof Error ? e.message : "Could not create session");
            replenishSessionWarmSlot({
              project: terminalProject,
              payload: defaultSessionPayload(project),
            });
          }
        })();
        return;
      }

      const isLocal = !!getElectron();
      const usesPersistedSession =
        payload.agent === "claude-code" ||
        payload.agent === "cursor-cli";
      const claudeSessionId = usesPersistedSession ? newSessionId() : null;
      const clientTaskId = isLocal ? newClientId("t") : undefined;
      const optimisticTask = buildOptimisticTask({
        id: clientTaskId,
        projectId: project.id,
        worktreeId: selectedWorktreeId,
        agent: payload.agent,
        branch: payload.branch,
        claudeSessionId,
        claudeSkipPermissions: agentSupportsSkipPermissions(payload.agent)
          ? payload.skipPermissions
          : undefined,
        claudeBareSession: payload.agent === "claude-code" ? payload.bareSession : undefined,
      });
      appendOptimisticTask(queryClient, project.id, selectedWorktreeId, optimisticTask);
      terminals.toggle(terminalProject, optimisticTask, { awaitCreate: !isLocal });

      void (async () => {
        try {
          const created = await api.createTaskInternal(project.id, {
            id: clientTaskId,
            title: TITLE_WAITING,
            agent: payload.agent,
            branch: payload.branch,
            claudeSessionId,
            claudeBareSession: payload.agent === "claude-code" ? payload.bareSession : undefined,
            claudeSkipPermissions: agentSupportsSkipPermissions(payload.agent)
              ? payload.skipPermissions
              : undefined,
            worktreeId: selectedWorktreeId,
          });
          replaceOptimisticTask(
            queryClient,
            project.id,
            selectedWorktreeId,
            optimisticTask.id,
            created.task,
          );
          if (clientTaskId && created.task.id === clientTaskId) {
            terminals.openSession(terminalProject, created.task);
          } else {
            terminals.adoptTaskId(optimisticTask.id, created.task);
          }
          void Promise.all([invalidateProject(), invalidateTasks(), invalidateProjects()]);
          replenishSessionWarmSlot({
            project: terminalProject,
            payload: defaultSessionPayload(project),
          });
          if (payload.agent === "codex" && !hasSeenCodexHooksNotice()) {
            setShowCodexHooksNotice(true);
          }
        } catch (e: unknown) {
          removeOptimisticTask(queryClient, project.id, selectedWorktreeId, optimisticTask.id);
          await terminals.close(optimisticTask.id);
          toast.error(e instanceof Error ? e.message : "Could not create session");
        }
      })();
    },
    [
      project,
      terminalProject,
      selectedWorktreeId,
      queryClient,
      invalidateProject,
      invalidateTasks,
      invalidateProjects,
      terminals,
      cliAvailability,
      showAgentUpdateRequired,
    ]
  );

  const startWithSaved = useCallback(() => {
    if (!project) return;
    if (!(project.rememberAgentSettings && project.savedAgent)) return;
    const savedAvailability = availabilityFor(cliAvailability, project.savedAgent);
    if (savedAvailability.status === "outdated") {
      showAgentUpdateRequired(project.savedAgent, savedAvailability);
      return;
    }
    if (savedAvailability.status === "missing") {
      setShowNewAgent(true);
      return;
    }
    createSession({
      agent: project.savedAgent,
      branch: project.branch || DEFAULT_BRANCH,
      skipPermissions: !!project.savedSkipPermissions,
      bareSession: project.savedAgent === "claude-code" ? !!project.savedBareSession : false,
    });
  }, [project, createSession, cliAvailability, showAgentUpdateRequired]);

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
    showWorktreeSetupConfig ||
    showInstallDiagramSkill ||
    showLaunchEmpty ||
    !!projectPathIssue ||
    projectPathCheck.state === "error" ||
    showCodexHooksNotice ||
    agentUpdateRequired !== null;

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
      onToggleDiffView();
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

  const deleteTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !project) return;

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId);
    void queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);

    const isActive = terminals.activeTaskIdFor(selectedScopeKey) === taskId;
    const next = isActive
      ? pickByPriority(tasks.filter((t) => !t.archived && t.id !== taskId))
      : undefined;

    // Point the panel at the replacement session before the deleted row disappears
    // or its PTY is torn down — otherwise close() briefly clears active and the
    // panel unmounts before the auto-select effect catches up.
    if (isActive && terminalProject) {
      if (next) terminals.openSession(terminalProject, next);
      else terminals.deselect(selectedScopeKey);
    }

    removeTaskFromCache(queryClient, project.id, selectedWorktreeId, taskId);

    void (async () => {
      showHostedCleanupStatus("session");
      try {
        await terminals.close(
          taskId,
          isActive ? { activateTaskId: next?.id ?? null } : undefined,
        );
        await api.deleteTask(taskId);
        void invalidateTasks();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks);
        }
        toast.error(e instanceof Error ? e.message : "Could not delete session");
      } finally {
        setCleanupStatus(null);
      }
    })();
  };

  const confirmRemoveProject = async () => {
    if (!project) return;
    setConfirmRemove(false);
    showHostedCleanupStatus("project");
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

  const clearFinished = () => {
    setConfirmClearFinished(false);
    if (!project) return;
    const finished = tasksByStatus.finished;
    if (finished.length === 0) return;

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId);
    void queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
    const finishedIds = new Set(finished.map((t) => t.id));
    removeTasksFromCache(queryClient, project.id, selectedWorktreeId, finishedIds);

    void (async () => {
      showHostedCleanupStatus("finishedSessions");
      try {
        await Promise.all(
          finished.map(async (t) => {
            await terminals.close(t.id).catch(() => undefined);
            await api.deleteTask(t.id).catch(() => undefined);
          }),
        );
        void invalidateTasks();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks);
        }
        toast.error(e instanceof Error ? e.message : "Could not clear finished sessions");
      } finally {
        setCleanupStatus(null);
      }
    })();
  };

  const clearDisconnected = () => {
    setConfirmClearDisconnected(false);
    if (!project) return;
    const disconnected = tasksByStatus.disconnected;
    if (disconnected.length === 0) return;

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId);
    void queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
    const disconnectedIds = new Set(disconnected.map((t) => t.id));
    removeTasksFromCache(queryClient, project.id, selectedWorktreeId, disconnectedIds);

    void (async () => {
      showHostedCleanupStatus("disconnectedSessions");
      try {
        await Promise.all(
          disconnected.map(async (t) => {
            await terminals.close(t.id).catch(() => undefined);
            await api.deleteTask(t.id).catch(() => undefined);
          }),
        );
        void invalidateTasks();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks);
        }
        toast.error(e instanceof Error ? e.message : "Could not clear disconnected sessions");
      } finally {
        setCleanupStatus(null);
      }
    })();
  };

  const startAgent = (data: {
    agent: Task["agent"];
    title: string;
    branch: string;
    dangerouslySkipPermissions: boolean;
    bareSession: boolean;
  }) => {
    setShowNewAgent(false);
    createSession({
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
        disabled={projectPathBlocked}
        disabledLabel="Folder unavailable"
        launchUrl={project.launchUrl ?? null}
        onStart={runLaunch}
        onOpenUrl={() =>
          project.launchUrl && window.electronAPI?.openExternal(project.launchUrl)
        }
        onStop={stopLaunch}
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
      {worktreesEnabled && (
        <>
          <WorktreeToggleGroup
            worktrees={worktrees}
            selectedId={selectedWorktree?.id ?? MAIN_WORKTREE_ID}
            runningKeys={launchRunningWorktreeIds}
            projectId={project.id}
            onSelect={selectWorktree}
            onDeleteSelected={() => setConfirmDeleteWorktree(true)}
            mainBranchLabel={gitStatus?.branch}
            branchSwitchDisabled={projectPathBlocked}
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
    </HeaderActions>
  );

  return (
    <>
      <CursorGlow />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: showDiffView ? "hidden" : "auto",
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
        className="dot-grid-bg"
      >
      <CardFrame
        style={{
          width: "100%",
          minHeight: showDiffView ? 0 : "100%",
          flex: showDiffView ? 1 : undefined,
          flexShrink: showDiffView ? undefined : 0,
          boxSizing: "border-box",
          padding: 8,
          display: showDiffView ? "flex" : undefined,
          flexDirection: showDiffView ? "column" : undefined,
          overflow: showDiffView ? "hidden" : undefined,
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
            margin: showDiffView ? "-8px -8px 12px" : "-8px -8px 32px",
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
            {overflowOpen &&
              overflowMenuRect &&
              createPortal(
              <CardFrame
                ref={overflowDropdownRef}
                role="menu"
                solid
                className="mc-project-actions-menu"
                style={{
                  position: "fixed",
                  top: overflowMenuRect.top,
                  left: overflowMenuRect.left,
                  minWidth: overflowMenuRect.minWidth,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 4,
                  boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
                  zIndex: 10000,
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
                <HotkeyTooltip action="file.finder">
                  <Btn
                    variant="ghost"
                    icon="search"
                    onClick={() => {
                      setOverflowOpen(false);
                      setFileFinderOpen(true);
                    }}
                    disabled={projectPathBlocked}
                    style={{ justifyContent: "flex-start" }}
                  >
                    <span style={{ flex: 1, textAlign: "left" }}>Find file in project</span>
                  </Btn>
                </HotkeyTooltip>
                {project.githubUrl && (
                  <>
                    <MenuSeparator />
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
                  </>
                )}
                <HotkeyTooltip action="git.diff">
                  <Btn
                    variant="ghost"
                    icon="git-branch"
                    onClick={() => {
                      setOverflowOpen(false);
                      onToggleDiffView();
                    }}
                    disabled={projectPathBlocked}
                    style={{ justifyContent: "flex-start" }}
                    title={
                      gitStatus && gitStatus.changedCount > 0
                        ? `${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"}`
                        : gitStatus
                          ? "Review Changes"
                          : "Checking changes…"
                    }
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
                <CreatePullRequestMenuItem
                  onSelect={() => {
                    setOverflowOpen(false);
                    void createPullRequest.onCreate();
                  }}
                  busy={createPullRequest.busy}
                />
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
                {worktreesEnabled ? (
                  <Btn
                    variant="ghost"
                    icon="terminal"
                    onClick={() => {
                      setOverflowOpen(false);
                      setShowWorktreeSetupConfig(true);
                    }}
                    style={{ justifyContent: "flex-start" }}
                  >
                    Configure worktree init command
                  </Btn>
                ) : null}
                <InstallDiagramSkillMenuItem
                  onSelect={() => {
                    setOverflowOpen(false);
                    setShowInstallDiagramSkill(true);
                  }}
                />
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
              </CardFrame>,
              document.body,
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
              changedCount={gitStatus?.changedCount}
              onClick={onToggleDiffView}
              disabled={projectPathBlocked}
            />
            <CommitPushButton
              projectId={id}
              worktreeId={selectedWorktreeId}
              size="md"
              splitTrailing
              enabled={projectPathUsable}
            />
          </div>
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

        {!showDiffView && visibleTasks.length > 0 && (
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
            gap: showDiffView ? 0 : 48,
            paddingInline: showDiffView ? 0 : 12,
            boxSizing: "border-box",
            flex: showDiffView ? 1 : undefined,
            minHeight: showDiffView ? 0 : undefined,
            overflow: showDiffView ? "hidden" : undefined,
          }}
        >
          {showDiffView ? (
            <GitDiffView
              projectId={project.id}
              worktreeId={selectedWorktreeId}
              projectPath={selectedWorktreePath || project.path}
              enabled={projectPathReady}
              onBack={closeDiffView}
            />
          ) : tasksQuery.isLoading ? (
            <EmptyState
              title="Loading sessions"
              subtitle="Fetching the hosted task list and terminal state."
              icon="sparkles"
            />
          ) : tasksQuery.isError ? (
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
          ) : visibleTasks.length === 0 ? (
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
          ) : (
            STATUS_DISPLAY_ORDER.filter((s) => tasksByStatus[s].length > 0).map((status) => (
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
            ))
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

      <AgentUpdateRequiredDialog
        open={agentUpdateRequired !== null}
        agent={agentUpdateRequired?.agent ?? null}
        availability={agentUpdateRequired?.availability ?? null}
        onClose={() => setAgentUpdateRequired(null)}
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
        onPrepareWarm={prepareWarmForDialog}
        onAgentUpdateRequired={showAgentUpdateRequired}
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
        onCreateGroup={createGroupForSelection}
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

      <CreatePullRequestDialog
        state={createPullRequest.dialog}
        onClose={createPullRequest.closeDialog}
      />

      <InstallDiagramSkillModal
        open={showInstallDiagramSkill}
        onClose={() => setShowInstallDiagramSkill(false)}
        projectPath={selectedWorktreePath || project.path}
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

      <WorktreeSetupCommandDialog
        open={showWorktreeSetupConfig}
        project={project}
        onClose={() => setShowWorktreeSetupConfig(false)}
        onSave={async (command) => {
          await api.updateProject(project.id, { worktreeSetupCommand: command });
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
  onDeleteSelected,
  mainBranchLabel,
  branchSwitchDisabled = false,
  maxWidth = 420,
}: {
  worktrees: WorktreeInfo[];
  selectedId: string;
  runningKeys: ReadonlySet<string>;
  projectId: string;
  onSelect: (id: string) => void;
  onDeleteSelected?: (worktree: WorktreeInfo) => void;
  /** Live git branch for the main worktree — shown instead of the "main" id. */
  mainBranchLabel?: string | null;
  branchSwitchDisabled?: boolean;
  maxWidth?: number | string;
}) {
  const items = worktrees.length > 0 ? worktrees : [];
  const selectableItems = items.filter((worktree) => !isOptimisticWorktree(worktree));
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
        overflowY: "visible",
        padding: 2,
        flexShrink: 1,
      }}
    >
      {items.map((worktree) => {
        const selected = worktree.id === selectedId;
        const optimistic = isOptimisticWorktree(worktree);
        const running = runningKeys.has(worktreeScopeKey(projectId, worktree.isMain ? null : worktree.id));
        const canDelete = selected && !worktree.isMain && !optimistic && !!onDeleteSelected;
        const label = worktree.isMain ? "main" : worktree.name;
        return (
          worktree.isMain && selected ? (
            <div
              key={worktree.id}
              role="none"
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                flexShrink: 0,
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
                    zIndex: 1,
                  }}
                />
              )}
              <BranchTypeahead
                projectId={projectId}
                worktreeId={null}
                branch={mainBranchLabel}
                displayLabel={label}
                disabled={branchSwitchDisabled}
                worktreePath={worktree.path}
                selected
              />
            </div>
          ) : (
          <div
            key={worktree.id}
            role="none"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              height: 28,
              borderRadius: 999,
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              background: selected ? "var(--accent-faint)" : "var(--surface-0)",
              color: selected ? "var(--accent)" : "var(--text-dim)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              whiteSpace: "nowrap",
              flexShrink: 0,
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
            <button
              type="button"
              role="radio"
              disabled={optimistic}
              onClick={() => onSelect(worktree.id)}
              onKeyDown={(event) => {
                if (optimistic) return;
                if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
                event.preventDefault();
                const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                const currentIndex = selectableItems.findIndex((item) => item.id === worktree.id);
                const next = selectableItems[
                  (currentIndex + direction + selectableItems.length) % selectableItems.length
                ];
                if (next) onSelect(next.id);
              }}
              aria-label={`Switch to worktree ${worktree.isMain ? label : worktree.name}`}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={
                optimistic
                  ? "Creating worktree..."
                  : worktree.isMain
                    ? `${worktree.path}${mainBranchLabel ? ` · branch ${mainBranchLabel}` : ""}`
                    : worktree.path
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "100%",
                padding: canDelete ? "0 8px 0 10px" : "0 10px",
                border: 0,
                borderRadius: canDelete ? "999px 0 0 999px" : 999,
                background: "transparent",
                color: "inherit",
                font: "inherit",
                whiteSpace: "nowrap",
                cursor: optimistic ? "default" : "pointer",
                opacity: optimistic ? 0.68 : 1,
              }}
            >
              {label}
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => onDeleteSelected?.(worktree)}
                aria-label={`Delete worktree ${worktree.name}`}
                title={`Delete worktree ${worktree.name}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  alignSelf: "stretch",
                  padding: 0,
                  border: 0,
                  borderLeft: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
                  borderRadius: "0 999px 999px 0",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  opacity: 0.78,
                }}
              >
                <Icon name="trash" size={10} />
              </button>
            )}
          </div>
          )
        );
      })}
    </div>
  );
}

function ProjectGitStatusButton({
  changedCount,
  onClick,
  disabled = false,
}: {
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
      ? "Open Review Changes"
      : `Toggle Review Changes · ${changedCount} changed file${changedCount === 1 ? "" : "s"}`;

  return (
    <HotkeyTooltip action="git.diff" label={title}>
      <Btn
        variant="ghost"
        icon="git-branch"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="mc-btn-attached-right"
        style={{ fontFamily: "var(--mono)", minWidth: 0 }}
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
    width: 52,
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
        <HotkeyTooltip action="project.runToggle" label="Stop launch commands">
          <Btn
            variant="danger"
            icon="stop"
            onClick={() => onStop()}
            aria-label="Stop launch commands"
            style={activeFrameIconStyle}
          />
        </HotkeyTooltip>
        {launchUrl ? (
          <Btn
            variant="ghost"
            icon="globe"
            onClick={onOpenUrl}
            title={`Open ${launchUrl} in browser`}
            aria-label={`Open ${launchUrl} in browser`}
            style={activeFrameIconStyle}
          />
        ) : null}
      </div>
    );
  }

  if (!running && !busy) {
    return (
      <HotkeyTooltip action="project.runToggle" label={title}>
        <Btn
          variant="ghost"
          icon="play"
          onClick={disabled || busy ? undefined : onStart}
          disabled={disabled || busy}
          aria-label={title}
          style={activeFrameIconStyle}
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
      </button>
    </HotkeyTooltip>
  );
}
