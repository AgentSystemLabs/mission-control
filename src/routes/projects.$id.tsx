import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { GridViewToggleIcon } from "~/components/ui/GridViewToggleIcon";
import { Z_INDEX } from "~/lib/z-index";
import { openExternal } from "~/lib/open-external";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { EmptyState } from "~/components/ui/EmptyState";
import { TaskColumn } from "~/components/views/TaskColumn";
import { ScreenshotThumbnail } from "~/components/views/ScreenshotThumbnail";
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
import { CustomScriptsDialog } from "~/components/views/CustomScriptsDialog";
import { CustomScriptsButton } from "~/components/views/CustomScriptsButton";
import { GridLayoutButton } from "~/components/views/GridLayoutButton";
import { NewSessionGridDialog } from "~/components/views/NewSessionGridDialog";
import { SessionGrid } from "~/components/views/SessionGrid";
import { saveGridColumnLimit } from "~/lib/grid-layout-prefs";
import { archiveOpenSession, invalidateSessionQueries } from "~/lib/archive-session";
import { enterFocusSession } from "~/lib/focus-session";
import { ScriptArgsModal } from "~/components/views/ScriptArgsModal";
import { WorktreeSetupCommandDialog } from "~/components/views/WorktreeSetupCommandDialog";
import { NewAgentButton } from "~/components/views/NewAgentButton";
import { CursorGlow } from "~/components/ui/CursorGlow";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { Modal } from "~/components/ui/Modal";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { RemoveProjectConfirmDialog } from "~/components/views/RemoveProjectConfirmDialog";
import { TextField } from "~/components/ui/TextField";
import { useHotkey } from "~/lib/use-hotkey";
import { ApiError, api, type AppSettings } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import {
  screenshotCaptureErrorMessage,
  screenshotFromResult,
  screenshotSupported as isScreenshotSupported,
} from "~/lib/screenshot";
import { playScreenshotCapture } from "~/lib/screenshot-sound";
import { isDockerSandboxRuntime } from "~/lib/sandbox-runtime";
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
  setTaskArchivedInCache,
  setTaskPinnedInCache,
  setTasksArchivedInCache,
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
import { useDebouncedCallback } from "~/lib/use-debounced-callback";
import {
  applyQuestionServerEvent,
  setQuestionOverlayEnabled,
} from "~/lib/agent-question-store";
import { setPendingInitialInput, takePendingInitialInput } from "~/lib/voice-session-prompts";
import {
  clearPendingSessionModel,
  peekPendingSessionModel,
  setPendingSessionModel,
} from "~/lib/session-model-overrides";
import { DEFAULT_SHIP_PROMPT } from "~/shared/ship-defaults";
import type { AiModelId } from "~/shared/ai-runtime-defaults";
import {
  VOICE_NEW_AGENT_EVENT,
  VOICE_OPEN_BROWSER_EVENT,
  VOICE_OPEN_DIFF_EVENT,
  VOICE_REMEMBER_EVENT,
  VOICE_RUN_PROJECT_EVENT,
  VOICE_RUN_SCRIPT_EVENT,
  type VoiceNewAgentDetail,
  type VoiceRememberDetail,
  type VoiceRunScriptDetail,
} from "~/lib/voice-events";
import { MEMORY_TITLE_MAX } from "~/shared/project-memory";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  groupActiveListTasksForDisplay,
  groupArchivedTasksForDisplay,
  groupTasksByStatusForDisplay,
} from "~/lib/task-display-order";
import {
  DEFAULT_BRANCH,
  type TaskAgent,
  parseLaunchCommands,
  parseCustomScripts,
  serializeCustomScripts,
  STATUS_DISPLAY_ORDER,
  TASK_STATUS_META,
  type CustomScript,
} from "~/shared/domain";
import { getPinnedProjectStatusDots } from "~/components/views/project-bar-status-dots";
import { hasRunningLaunchSessions } from "~/lib/project-launch-running";
import { agentSupportsSkipPermissions } from "~/shared/agents";
import {
  queryKeys,
  useApiToken,
  useGroups,
  useProject,
  useSandboxes,
  useSettings,
  useTasks,
  useWorktrees,
} from "~/queries";
import { useWorktreesEnabled } from "~/lib/use-worktrees-enabled";
import { useGitStatus } from "~/queries/git";
import { GitDiffModal } from "~/components/views/GitDiffView/GitDiffModal";
import { CommitPushButton } from "~/components/views/CommitPushButton";
import { RecallModal } from "~/components/views/RecallModal";
import { BranchTypeahead } from "~/components/views/BranchTypeahead";
import {
  CreatePullRequestDialog,
  CreatePullRequestMenuItem,
  useCreatePullRequestAction,
} from "~/components/views/CreatePullRequestButton";
import { HeaderActions, HeaderBeforeSearch } from "~/components/ui/HeaderActionsSlot";
import { InstallDiagramSkillMenuItem } from "~/components/views/InstallDiagramSkillMenuItem";
import { InstallDiagramSkillModal } from "~/components/views/InstallDiagramSkillModal";
import { InstallShipSkillMenuItem } from "~/components/views/InstallShipSkillMenuItem";
import { InstallShipSkillModal } from "~/components/views/InstallShipSkillModal";
import { SandboxProvisioningState } from "~/components/views/SandboxProvisioningState";
import {
  isSandboxProvisioning,
  useRemoteVmDeployForSandbox,
} from "~/lib/use-remote-vm-deploy-for-sandbox";
import {
  availabilityFor,
  type CliAvailability,
  useCliAvailability,
} from "~/lib/cli-availability";
import {
  activateSandboxScope,
  projectRuntimeScopeId,
  scopeIdToActivate,
} from "~/lib/activate-sandbox-scope";
import {
  SESSION_NOTIFICATION_OPEN_EVENT,
  clearPendingSessionOpen,
  readPendingSessionOpen,
  type PendingSessionOpen,
} from "~/lib/session-notification-store";
import type { Group, Project, Task, TaskStatus } from "~/db/schema";
import type { ProjectPathStatus } from "~/shared/projects";
import type { WorktreeInfo } from "~/shared/worktrees";
import { MAIN_WORKTREE_ID, worktreeScopeKey } from "~/shared/worktrees";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";
import { scopeKeyForProject } from "~/lib/scoped-project";
import {
  readCachedSelectedWorktreeByProject,
  writeCachedSelectedWorktreeByProject,
} from "~/lib/ui-preference-cache";
import {
  selectedWorktreeMapsEqual,
  type SelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import {
  ARCHIVE_ACTIVE_SESSION_EVENT,
  DUPLICATE_ACTIVE_SESSION_EVENT,
  pickByPriority,
  STATUS_META,
  type ArchiveActiveSessionEventDetail,
} from "~/lib/design-meta";
import { useSyncProjectDiagrams } from "~/lib/use-diagram-events";
import { useGitDiffViewOpen } from "~/lib/git-diff-view-store";

export const Route = createFileRoute("/projects/$id")({
  component: ProjectPage,
});

type DeleteWorktreeMode = "clean" | "stash" | "discard";
type SessionView = "active" | "pinned" | "archived";
const WORKTREE_DELETE_FILES_MAX_HEIGHT = 220;

function apiErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError) {
    const body =
      error.body && typeof error.body === "object"
        ? (error.body as { error?: unknown; stderr?: unknown })
        : null;
    if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    if (typeof body?.stderr === "string" && body.stderr.trim()) return body.stderr.trim();
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return null;
}

function gitUnavailableTitle(error: unknown): string {
  const message = apiErrorMessage(error);
  return message ? `Git unavailable: ${message}` : "Git unavailable";
}

function worktreeChangeLabel(count: number | undefined): string {
  if (count === undefined) return "Checking changes";
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

function deleteWorktreeOptionsForMode(mode: DeleteWorktreeMode): {
  force?: boolean;
  stashChanges?: boolean;
} {
  if (mode === "stash") return { stashChanges: true };
  if (mode === "discard") return { force: true };
  return {};
}

function formatWorktreeChangeStatus(area: "staged" | "unstaged", status: string): string {
  const areaLabel = area === "staged" ? "Staged" : "Unstaged";
  return `${areaLabel} ${status.replace("-", " ")}`;
}

type ProjectPathCheck =
  | { state: "idle" | "checking" | "valid" }
  | { state: "invalid"; status: Extract<ProjectPathStatus, { ok: false }> }
  | { state: "error"; message: string };

const OPTIMISTIC_WORKTREE_ID_PREFIX = "wt-optimistic-";

function isCurrentPathIssue(
  status: Extract<ProjectPathStatus, { ok: false }>,
  selectedWorktreeId: string | null,
): boolean {
  if (status.scope === "project") return selectedWorktreeId === null;
  return status.worktreeId === selectedWorktreeId;
}

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

function firstDisplayedTask<T extends { status: TaskStatus }>(tasks: T[]): T | undefined {
  for (const status of STATUS_DISPLAY_ORDER) {
    const task = tasks.find((t) => t.status === status);
    if (task) return task;
  }
  return undefined;
}

/** The task id of the grid cell whose terminal currently holds focus (the pane
 *  the user is looking at), or null outside grid view / when nothing is focused.
 *  Clone and "new session" both anchor a fresh session on this so it lands
 *  beside — and takes the caret from — the active pane. */
function readFocusedGridTaskId(): string | null {
  if (typeof document === "undefined") return null;
  const cell = document.activeElement?.closest("[data-grid-cell]") as HTMLElement | null;
  return cell?.getAttribute("data-task-id") ?? null;
}

function ProjectPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const settingsLoaded = settings !== undefined;
  // Mirror the beta flag into the question store: gates the pane overlays and
  // releases any withheld TUI menu the moment the popup is switched off.
  useEffect(() => {
    if (typeof settings?.questionOverlayEnabled === "boolean") {
      setQuestionOverlayEnabled(settings.questionOverlayEnabled);
    }
  }, [settings?.questionOverlayEnabled]);
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
  const { data: sandboxState } = useSandboxes();
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
  const activeRuntimeSandbox =
    sandboxState?.activeScopeId && sandboxState.activeScopeId !== LOCAL_SCOPE_ID
      ? sandboxState.sandboxes.find((sandbox) => sandbox.id === sandboxState.activeScopeId) ?? null
      : null;
  const activeRuntimeScopeId =
    sandboxState?.enabled &&
    activeRuntimeSandbox?.kind === "remote-vm" &&
    activeRuntimeSandbox.remoteProvider === "aws" &&
    activeRuntimeSandbox.projectId === project?.id
      ? sandboxState.activeScopeId
      : LOCAL_SCOPE_ID;
  const deploySandboxId = activeRuntimeSandbox?.id ?? null;
  const { deployJob, deployLogText } = useRemoteVmDeployForSandbox(deploySandboxId);
  const sandboxProvisioning =
    activeRuntimeSandbox != null &&
    isSandboxProvisioning(activeRuntimeSandbox, deployJob);
  const selectedScopeKey = `${worktreeScopeKey(id, selectedWorktreeId)}:${activeRuntimeScopeId}`;
  const scopedProject = useMemo(
    () =>
      project
        ? {
            ...project,
            path: selectedWorktreePath || project.path,
            activeWorktreeId: selectedWorktreeId,
            activeRuntimeScopeId,
          }
        : null,
    [activeRuntimeScopeId, project, selectedWorktreeId, selectedWorktreePath],
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
    projectPathCheck.state === "invalid" &&
    isCurrentPathIssue(projectPathCheck.status, selectedWorktreeId)
      ? projectPathCheck.status
      : null;
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
      ? `${terminalProject.id}:${terminalProject.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}:${terminalProject.path}:${sessionCreateSignature(defaultWarmPayload, terminalProject.path)}`
      : null;
  // Read the latest inputs through a ref so a project-query refetch that returns
  // a new `project` reference with identical data doesn't change the effect deps
  // and churn the warm slot (kill + respawn a full agent PTY). `warmPrepareKey`
  // already encodes everything that should trigger teardown/re-prepare.
  const warmInputRef = useRef({ terminalProject, defaultWarmPayload });
  warmInputRef.current = { terminalProject, defaultWarmPayload };
  useEffect(() => {
    const { terminalProject, defaultWarmPayload } = warmInputRef.current;
    if (!terminalProject || !defaultWarmPayload || !warmPrepareKey) return;
    void prefetchTerminalModules();
    void prepareSessionWarmSlot({ project: terminalProject, payload: defaultWarmPayload });
    return () => {
      void discardSessionWarmSlot();
    };
    // Depend only on warmPrepareKey (the stable logical key); inputs come from the ref.
  }, [warmPrepareKey]);

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
  const tasksQuery = useTasks(id, selectedWorktreeId, activeRuntimeScopeId);
  const tasks = tasksQuery.data ?? [];
  const wasSandboxProvisioningRef = useRef(false);
  useEffect(() => {
    if (wasSandboxProvisioningRef.current && !sandboxProvisioning) {
      void tasksQuery.refetch();
    }
    wasSandboxProvisioningRef.current = sandboxProvisioning;
  }, [sandboxProvisioning, tasksQuery]);
  const hasArchivedTasks = tasks.some((t) => t.archived);
  // Live pinned-session ids for the grid's "Pinned" filter — derived from the
  // task query (not the store's open-time snapshot) so a pin toggle reflects
  // immediately. Memoized so SessionGrid's filter doesn't churn every render.
  const pinnedTaskIds = useMemo(
    () => new Set(tasks.filter((t) => !t.archived && t.pinned).map((t) => t.id)),
    [tasks],
  );
  const groups = groupsQuery.data ?? [];
  useApiToken();
  const {
    data: gitStatusData,
    error: gitStatusError,
    isError: gitStatusIsError,
    refetch: refetchGitStatus,
  } = useGitStatus(id, selectedWorktreeId, {
    enabled: projectPathUsable,
  });
  const gitStatus = gitStatusIsError ? undefined : gitStatusData;
  const gitUnavailable = projectPathReady && gitStatusIsError;
  const gitUnavailableMessage = gitUnavailable ? gitUnavailableTitle(gitStatusError) : null;
  const createPullRequest = useCreatePullRequestAction({
    projectId: id,
    worktreeId: selectedWorktreeId,
    branch: gitStatus?.branch,
    projectPathUsable,
  });
  const { open: showDiffView, toggle: toggleDiffView, close: closeDiffView, setOpen: setDiffViewOpen } =
    useGitDiffViewOpen(id);
  // onToggleDiffView is defined lower down (after `terminals`) because opening
  // the diff must also drop out of the grid view — see the comment there.
  useEffect(() => {
    if (projectPathBlocked) closeDiffView();
  }, [projectPathBlocked, closeDiffView]);
  const [showNewAgent, setShowNewAgent] = useState(false);
  // The grid-shape batch launcher ("new session grid") — grid view only.
  const [showNewSessionGrid, setShowNewSessionGrid] = useState(false);
  // Where the session created from the New Agent dialog should land in the grid:
  // "newRow" is set by the grid's "New row" button so the result starts a fresh
  // row; "default" (the New session button / hotkey) uses the current row.
  const [newAgentTarget, setNewAgentTarget] = useState<"default" | "newRow">("default");
  const [showEdit, setShowEdit] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [sessionView, setSessionView] = useState<SessionView>("active");
  const showArchived = sessionView === "archived";
  const showPinned = sessionView === "pinned";
  const [pinningTaskIds, setPinningTaskIds] = useState<Set<string>>(() => new Set());
  const pinRequestSeqRef = useRef<Record<string, number>>({});
  const [confirmDeleteArchived, setConfirmDeleteArchived] = useState(false);
  const [confirmArchiveAll, setConfirmArchiveAll] = useState(false);
  const [archivingAll, setArchivingAll] = useState(false);
  // Leave the archived view automatically once it empties (last one restored
  // or deleted) so the toggle never strands the user on a blank list.
  useEffect(() => {
    if (sessionView === "archived" && !hasArchivedTasks) setSessionView("active");
  }, [sessionView, hasArchivedTasks]);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [fileFinderResetKey, setFileFinderResetKey] = useState(0);
  const [openFileRel, setOpenFileRel] = useState<string | null>(null);
  const openFileFinderFresh = useCallback(() => {
    setFileFinderResetKey((v) => v + 1);
    setFileFinderOpen(true);
  }, []);
  const [showLaunchConfig, setShowLaunchConfig] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const [recallInitialFilter, setRecallInitialFilter] = useState<"all" | "recent">("all");
  const [showCustomScriptsConfig, setShowCustomScriptsConfig] = useState(false);
  const [showWorktreeSetupConfig, setShowWorktreeSetupConfig] = useState(false);
  const [showInstallDiagramSkill, setShowInstallDiagramSkill] = useState(false);
  const [showInstallShipSkill, setShowInstallShipSkill] = useState(false);
  const [showLaunchEmpty, setShowLaunchEmpty] = useState(false);
  const [confirmDeleteWorktree, setConfirmDeleteWorktree] = useState(false);
  const [worktreeDeleteConfirmName, setWorktreeDeleteConfirmName] = useState("");
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
  useEffect(() => {
    setProjectPathActionError(null);
  }, [projectPathCheck.state, projectPathIssue?.path]);
  const launchCommands = parseLaunchCommands(project?.launchCommands ?? null);
  const customScripts = useMemo(
    () => parseCustomScripts(project?.customScripts ?? null),
    [project?.customScripts]
  );
  const launchCommandSet = useMemo(
    () =>
      new Set(launchCommands.map((c) => c.command.trim()).filter(Boolean)),
    [launchCommands]
  );
  const cliAvailability = useCliAvailability();
  const selectedWorktreeChangeCount = selectedWorktree && !selectedWorktree.isMain
    ? gitStatus?.changedCount
    : undefined;
  const selectedWorktreeDirty =
    !!selectedWorktree && !selectedWorktree.isMain && (selectedWorktreeChangeCount ?? 0) > 0;
  const selectedWorktreeStatusPending =
    !!selectedWorktree &&
    !selectedWorktree.isMain &&
    selectedWorktreeChangeCount === undefined &&
    projectPathUsable;
  const worktreeDiscardConfirmMatches =
    !!selectedWorktree && worktreeDeleteConfirmName.trim() === selectedWorktree.name;
  const worktreeChangedFiles = useMemo(() => {
    return [
      ...(gitStatus?.staged ?? []).map((file) => ({ ...file, area: "staged" as const })),
      ...(gitStatus?.unstaged ?? []).map((file) => ({ ...file, area: "unstaged" as const })),
    ];
  }, [gitStatus?.staged, gitStatus?.unstaged]);

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
  const gridViewActive = terminals.gridView;

  // Native screenshot capture is macOS-only (uses `screencapture -i`) and needs
  // the Electron bridge, so the toolbar button, capture stack, and history strip
  // are hidden elsewhere. Gate on the main process's real platform (see
  // screenshotSupported) rather than the deprecated navigator.platform.
  const screenshotSupported = useMemo(() => isScreenshotSupported(), []);
  const addScreenshot = terminals.addScreenshot;
  const captureScreenshot = useCallback(async () => {
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
      addScreenshot({ ...shot, projectId: id });
    }
  }, [addScreenshot, id]);
  // Review Changes in grid view docks the diff as a resizable panel beside the
  // live grid (see the split render below) instead of taking over the workspace,
  // so the sessions stay visible while you review. gridView state stays on, so
  // closing the diff returns to the full grid.
  const onToggleDiffView = useCallback(() => {
    if (!projectPathReady) return;
    toggleDiffView();
  }, [projectPathReady, toggleDiffView]);
  // How many sessions the current scope's grid shows (drives "Archive all").
  const gridScopeSessionCount = useMemo(
    () =>
      terminals.sessions.filter((s) => scopeKeyForProject(s.project) === selectedScopeKey).length,
    [terminals.sessions, selectedScopeKey],
  );
  // The grid only takes over the workspace once the scope has a session to show.
  // With none, we fall back to the normal sessions view so an empty grid matches
  // the single-panel empty state exactly (header and all) instead of a bare
  // centered message. Archived is a list-only management view (no live terminals
  // to grid), so selecting it drops back to the list; the grid filters only
  // between Active and Pinned (SessionGrid handles the empty-Pinned state).
  const showGrid =
    gridViewActive && sessionView !== "archived" && gridScopeSessionCount > 0;
  const syncTask = terminals.syncTask;
  const rehydrateTerminal = terminals.rehydrate;
  const toggleTerminalSession = terminals.toggle;
  const setVisibleTerminalScope = terminals.setVisibleScope;
  // "Grid view — show all sessions": entering the grid materializes every
  // active session for the visible worktree/scope, not just the already-open
  // ones. TerminalPane's spawn queue staggers the agent launches.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const enterGridView = useCallback(() => {
    // Keep any open Review Changes diff open across the switch — the grid docks
    // it as a side panel rather than fighting for the slot, so switching views
    // shouldn't dismiss the review.
    terminals.setGridView(true);
    if (!terminalProject) return;
    for (const task of tasksRef.current) {
      if (task.archived) continue;
      rehydrateTerminal(terminalProject, task);
    }
    // Focus the session that was active in normal view so entering the grid keeps
    // the same session current instead of landing on an arbitrary cell.
    // focusGridSession retries until that cell's pane mounts.
    const activeTaskId = terminals.activeTaskIdFor(selectedScopeKey);
    if (activeTaskId) terminals.focusGridSession(activeTaskId);
  }, [terminals, terminalProject, rehydrateTerminal, selectedScopeKey]);
  const toggleGridViewShowingAll = useCallback(() => {
    if (terminals.gridView) {
      // Carry the grid's focused session into normal view so leaving the grid
      // shows the pane you were looking at, not whatever was active before.
      // DOM focus first (hotkey exit, cell still focused); then the grid's
      // last-focused cell reported to the store (a header-button click moved
      // focus off the grid).
      const focused = readFocusedGridTaskId() ?? terminals.getGridFocusedTaskId();
      if (focused && terminalProject && tasks.some((t) => t.id === focused)) {
        terminals.setActiveSession(terminalProject, focused);
      }
      terminals.setGridView(false);
      // List view no longer has the Active/Pinned/Archived scope toggle — pinned
      // is grid-only, so drop back to the active list when leaving the grid.
      setSessionView((prev) => (prev === "pinned" ? "active" : prev));
    } else {
      enterGridView();
    }
  }, [terminals, enterGridView, terminalProject, tasks]);
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

  // Script awaiting argument values before it can run (null when none pending).
  const [argsScript, setArgsScript] = useState<CustomScript | null>(null);

  const executeScript = useCallback(
    async (script: CustomScript, command: string) => {
      try {
        await createTerminal({ name: script.name, startCommand: command });
        setPanelOpen(true);
      } catch {
        toast.error(`Failed to run ${script.name}`);
      }
    },
    [createTerminal, setPanelOpen]
  );

  const runShipSkillInstallCommand = useCallback(
    async (command: string) => {
      try {
        await createTerminal({
          name: "Install ship skills",
          startCommand: command,
          cwd: selectedWorktreePath || project?.path || null,
        });
        setPanelOpen(true);
        toast.success("Started ship skill install in a terminal.");
      } catch {
        toast.error("Failed to start ship skill install terminal.");
        throw new Error("Failed to start install terminal");
      }
    },
    [createTerminal, project?.path, selectedWorktreePath, setPanelOpen]
  );

  const runScript = useCallback(
    (script: CustomScript) => {
      if (!projectPathReady) return;
      // Scripts with declared args open a fill-in modal first; the rest run as-is.
      if (script.args && script.args.length > 0) {
        setArgsScript(script);
        return;
      }
      void executeScript(script, script.command);
    },
    [projectPathReady, executeScript]
  );

  useEffect(() => {
    if (terminalProject) setActiveUserTerminalProject(terminalProject);
  }, [terminalProject, setActiveUserTerminalProject]);

  useLayoutEffect(() => {
    setVisibleTerminalScope(id, selectedScopeKey);
    return () => setVisibleTerminalScope(id, null);
  }, [id, selectedScopeKey, setVisibleTerminalScope]);

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
  const archiveSessionRef = useRef<(taskId: string) => void>(() => undefined);
  const previousSessionScopeRef = useRef<{ projectId: string; scopeKey: string }>({
    projectId: id,
    scopeKey: selectedScopeKey,
  });
  const pendingWorktreeSessionSelectRef = useRef<string | null>(null);
  useEffect(() => {
    const onArchiveRequest = (e: Event) => {
      const taskId = (e as CustomEvent<ArchiveActiveSessionEventDetail>).detail?.taskId;
      if (typeof taskId !== "string") return;
      archiveSessionRef.current(taskId);
    };
    window.addEventListener(ARCHIVE_ACTIVE_SESSION_EVENT, onArchiveRequest);
    return () => window.removeEventListener(ARCHIVE_ACTIVE_SESSION_EVENT, onArchiveRequest);
  }, []);
  useEffect(() => {
    const previous = previousSessionScopeRef.current;
    previousSessionScopeRef.current = { projectId: id, scopeKey: selectedScopeKey };
    if (previous.projectId !== id) {
      pendingWorktreeSessionSelectRef.current = null;
      return;
    }
    if (previous.scopeKey !== selectedScopeKey) {
      pendingWorktreeSessionSelectRef.current = selectedScopeKey;
    }
  }, [id, selectedScopeKey]);

  useEffect(() => {
    if (pendingWorktreeSessionSelectRef.current !== selectedScopeKey) return;
    if (!terminalProject || tasksQuery.isLoading || tasksQuery.isError) return;

    pendingWorktreeSessionSelectRef.current = null;
    const firstTask = firstDisplayedTask(tasks.filter((t) => !t.archived));
    if (!firstTask) {
      terminals.deselect(selectedScopeKey);
      return;
    }

    const currentActiveTaskId = terminals.activeTaskIdFor(selectedScopeKey);
    if (currentActiveTaskId === firstTask.id) {
      if (!terminals.activeFor(selectedScopeKey)) {
        terminals.rehydrate(terminalProject, firstTask);
      }
      return;
    }

    terminals.openSession(terminalProject, firstTask);
  }, [
    selectedScopeKey,
    terminalProject,
    tasks,
    tasksQuery.isLoading,
    tasksQuery.isError,
    terminals,
  ]);

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
      void (async () => {
        if (!terminalProject || request.projectId !== id) return;
        // In grid view every open session is already on screen regardless of the
        // selected worktree/scope, so the panel-switching logic below does
        // nothing visible. If the target session is live, just spotlight its cell
        // so the user can pick it out; the scope guards would otherwise no-op.
        if (terminals.gridView && terminals.sessions.some((s) => s.taskId === request.taskId)) {
          terminals.focusGridSession(request.taskId);
          clearPendingSessionOpen(request);
          return;
        }
        if (!worktreesQuery.data) return;
        if (!worktreesEnabled && request.worktreeId && request.worktreeId !== MAIN_WORKTREE_ID) {
          clearPendingSessionOpen(request);
          return;
        }

        let resolvedScopeId = normalizeScopeId(request.scopeId);
        let resolvedWorktreeId = request.worktreeId;
        let task = tasks.find((entry) => entry.id === request.taskId && !entry.archived) ?? null;

        if (task) {
          resolvedScopeId = normalizeScopeId(task.scopeId);
          resolvedWorktreeId = task.worktreeId ?? null;
        } else if (tasksQuery.isLoading || sandboxProvisioning) {
          return;
        } else {
          try {
            const { task: remoteTask } = await api.getTask(request.taskId);
            if (!remoteTask || remoteTask.projectId !== id || remoteTask.archived) {
              clearPendingSessionOpen(request);
              return;
            }
            task = remoteTask;
            resolvedScopeId = normalizeScopeId(remoteTask.scopeId);
            resolvedWorktreeId = remoteTask.worktreeId ?? null;
          } catch {
            clearPendingSessionOpen(request);
            return;
          }
        }

        const targetRuntimeScopeId = projectRuntimeScopeId(sandboxState, id, resolvedScopeId);
        const activateTo = scopeIdToActivate(sandboxState, id, resolvedScopeId);
        const globalActiveScopeId = normalizeScopeId(sandboxState?.activeScopeId ?? LOCAL_SCOPE_ID);

        if (globalActiveScopeId !== activateTo) {
          const switched = await activateSandboxScope(queryClient, activateTo);
          if (!switched) clearPendingSessionOpen(request);
          return;
        }

        if (activeRuntimeScopeId !== targetRuntimeScopeId) return;

        const requestedWorktreeKey = resolvedWorktreeId ?? MAIN_WORKTREE_ID;
        const requestedWorktreeExists =
          requestedWorktreeKey === MAIN_WORKTREE_ID ||
          worktreesQuery.data.some((worktree) => worktree.id === requestedWorktreeKey);
        if (!requestedWorktreeExists) {
          clearPendingSessionOpen(request);
          return;
        }

        if (requestedWorktreeKey !== selectedWorktreeKey) {
          setSelectedWorktreeByProject((prev) =>
            prev[id] === requestedWorktreeKey
              ? prev
              : { ...prev, [id]: requestedWorktreeKey },
          );
          return;
        }

        if (!task) {
          task = tasks.find((entry) => entry.id === request.taskId && !entry.archived) ?? null;
        }
        if (!task) {
          if (tasksQuery.isLoading || sandboxProvisioning) return;
          clearPendingSessionOpen(request);
          return;
        }

        const active = terminals.activeFor(selectedScopeKey);
        if (active?.taskId !== task.id) {
          const activeTaskId = terminals.activeTaskIdFor(selectedScopeKey);
          if (activeTaskId === task.id) terminals.rehydrate(terminalProject, task);
          else terminals.toggle(terminalProject, task);
        }
        // Now that the session is materialized in the grid, spotlight its cell.
        if (terminals.gridView) terminals.focusGridSession(task.id);
        clearPendingSessionOpen(request);
      })();
    },
    [
      id,
      terminalProject,
      selectedScopeKey,
      selectedWorktreeKey,
      activeRuntimeScopeId,
      sandboxState,
      tasks,
      tasksQuery.isLoading,
      sandboxProvisioning,
      terminals,
      worktreesEnabled,
      worktreesQuery.data,
      queryClient,
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
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(id, selectedWorktreeId, activeRuntimeScopeId) }),
    [queryClient, id, selectedWorktreeId, activeRuntimeScopeId]
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
    if (!worktreesEnabled || !project || creatingWorktreeRef.current || projectPathBlocked || gitUnavailable) {
      if (gitUnavailableMessage) toast.error(gitUnavailableMessage);
      return;
    }
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
          activeRuntimeScopeId,
        };
        await createTerminal({
          project: setupProject,
          name: `Setup: ${result.worktree.name}`,
          startCommand: result.setupCommand,
        });
      }
      toast.success(`Created worktree ${result.worktree.name}`);
    } catch (e: unknown) {
      queryClient.setQueryData<WorktreeInfo[]>(worktreesKey, (current) =>
        current?.filter((worktree) => worktree.id !== optimisticWorktree.id) ?? current
      );
      void invalidateWorktrees();
      toast.error(e instanceof Error ? e.message : "Could not create worktree");
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
    activeRuntimeScopeId,
    projectPathBlocked,
    gitUnavailable,
    gitUnavailableMessage,
  ]);

  const closeDeleteWorktreeDialog = useCallback(() => {
    setConfirmDeleteWorktree(false);
    setWorktreeDeleteConfirmName("");
  }, []);

  const reviewSelectedWorktreeChanges = useCallback(() => {
    closeDeleteWorktreeDialog();
    setDiffViewOpen(true);
  }, [closeDeleteWorktreeDialog, setDiffViewOpen]);

  const deleteSelectedWorktree = useCallback(async (mode: DeleteWorktreeMode = "clean") => {
    if (!worktreesEnabled || !project || !selectedWorktree || selectedWorktree.isMain) return;
    if (launchRunningWorktreeIds.has(selectedScopeKey)) {
      toast.error("Stop this worktree before deleting it.");
      return;
    }
    setDeletingWorktree(true);
    const worktreesKey = queryKeys.worktrees(project.id);
    const previousWorktrees = queryClient.getQueryData<WorktreeInfo[]>(worktreesKey);
    const previousSelectedWorktreeKey = selectedWorktreeKey;
    try {
      await queryClient.cancelQueries({ queryKey: worktreesKey });
      closeDeleteWorktreeDialog();
      selectWorktree(MAIN_WORKTREE_ID);
      setProjectPathCheck({ state: "checking" });
      setProjectPathActionError(null);
      queryClient.setQueryData<WorktreeInfo[]>(worktreesKey, (current) =>
        current?.filter((worktree) => worktree.id !== selectedWorktree.id) ?? current
      );
      // Kill any terminals/agents running inside this worktree first. On Windows
      // their open file handles (notably Claude Code's `.claude/` dir) would
      // otherwise hold a lock that makes `git worktree remove` fail with
      // "Permission denied", leaving the worktree half-deleted.
      const electron = getElectron();
      if (electron && selectedWorktree.path) {
        await electron.pty.killUnderPath(selectedWorktree.path).catch(() => undefined);
      }
      await api.deleteWorktree(
        project.id,
        selectedWorktree.id,
        deleteWorktreeOptionsForMode(mode),
      );
      await Promise.all([
        invalidateWorktrees(),
        invalidateTasks(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.scopedUserTerminals(
            project.id,
            selectedWorktree.id,
            activeRuntimeScopeId,
          ),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
      toast.success(
        mode === "stash"
          ? `Stashed changes and deleted worktree ${selectedWorktree.name}`
          : `Deleted worktree ${selectedWorktree.name}`,
      );
    } catch (e: unknown) {
      if (previousWorktrees) {
        queryClient.setQueryData(worktreesKey, previousWorktrees);
      } else {
        void invalidateWorktrees();
      }
      selectWorktree(previousSelectedWorktreeKey);
      const isConflict = e instanceof ApiError && e.status === 409;
      if (isConflict) void refetchGitStatus();
      setConfirmDeleteWorktree(true);
      toast.error(
        isConflict
          ? "This worktree has changes. Choose how to handle them before deleting."
          : e instanceof Error ? e.message : "Could not delete worktree",
      );
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
    closeDeleteWorktreeDialog,
    invalidateWorktrees,
    invalidateTasks,
    queryClient,
    refetchGitStatus,
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
    async (
      payload: SessionCreatePayload,
      opts?: { initialInput?: string; focusOnCreate?: boolean; model?: AiModelId | null },
    ) => {
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

      const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId, activeRuntimeScopeId);
      void queryClient.cancelQueries({ queryKey: tasksKey });

      // A voice-seeded prompt can't ride a pre-spawned warm slot (it was launched
      // before we knew the prompt), so fall back to the cold path when set.
      const warmSlot = (await isDockerSandboxRuntime()) || opts?.initialInput
        ? null
        : takeSessionWarmSlot(payload, terminalProject.path);
      if (warmSlot) {
        appendOptimisticTask(
          queryClient,
          project.id,
          selectedWorktreeId,
          warmSlot.draftTask,
          activeRuntimeScopeId,
        );
        terminals.openSession(terminalProject, warmSlot.draftTask, { ptyId: warmSlot.ptyId });
        // Clone/new-session focus: put the caret in the just-added grid cell so
        // the user can type immediately. focusGridSession retries until the pane
        // mounts, so calling it before the surface exists is fine.
        if (opts?.focusOnCreate && terminals.gridView) {
          terminals.focusGridSession(warmSlot.draftTask.id);
        }
        void (async () => {
          try {
            const task = await persistWarmSlotTask(
              project.id,
              warmSlot,
              selectedWorktreeId,
              activeRuntimeScopeId,
            );
            replaceOptimisticTask(
              queryClient,
              project.id,
              selectedWorktreeId,
              warmSlot.clientTaskId,
              task,
              activeRuntimeScopeId,
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
            removeOptimisticTask(
              queryClient,
              project.id,
              selectedWorktreeId,
              warmSlot.clientTaskId,
              activeRuntimeScopeId,
            );
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
        scopeId: activeRuntimeScopeId,
        agent: payload.agent,
        branch: payload.branch,
        claudeSessionId,
        claudeSkipPermissions: agentSupportsSkipPermissions(payload.agent)
          ? payload.skipPermissions
          : undefined,
        claudeBareSession: payload.agent === "claude-code" ? payload.bareSession : undefined,
      });
      appendOptimisticTask(queryClient, project.id, selectedWorktreeId, optimisticTask, activeRuntimeScopeId);
      if (opts?.initialInput) {
        // TerminalPane consumes this once, at the first spawn, as the PTY's
        // initialInput — the main process writes it after the agent TUI is ready.
        setPendingInitialInput(optimisticTask.id, opts.initialInput);
      }
      if (opts?.model) {
        setPendingSessionModel(optimisticTask.id, opts.model);
      }
      terminals.toggle(terminalProject, optimisticTask, { awaitCreate: !isLocal });
      // Clone/new-session focus: put the caret in the just-added grid cell so the
      // user can type immediately. focusGridSession retries until the pane mounts
      // (and re-asserts across the awaitingCreate→persisted rebuild), so calling
      // it here — before the surface exists — is fine.
      if (opts?.focusOnCreate && terminals.gridView) {
        terminals.focusGridSession(optimisticTask.id);
      }

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
            scopeId: activeRuntimeScopeId,
          });
          replaceOptimisticTask(
            queryClient,
            project.id,
            selectedWorktreeId,
            optimisticTask.id,
            created.task,
            activeRuntimeScopeId,
          );
          if (clientTaskId && created.task.id === clientTaskId) {
            terminals.openSession(terminalProject, created.task);
          } else {
            const pendingModel = peekPendingSessionModel(optimisticTask.id);
            if (pendingModel) {
              clearPendingSessionModel(optimisticTask.id);
              setPendingSessionModel(created.task.id, pendingModel);
            }
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
          // The session never spawned — discard any voice prompt / model staged for it.
          takePendingInitialInput(optimisticTask.id);
          clearPendingSessionModel(optimisticTask.id);
          removeOptimisticTask(
            queryClient,
            project.id,
            selectedWorktreeId,
            optimisticTask.id,
            activeRuntimeScopeId,
          );
          await terminals.close(optimisticTask.id);
          toast.error(e instanceof Error ? e.message : "Could not create session");
        }
      })();
    },
    [
      project,
      terminalProject,
      selectedWorktreeId,
      activeRuntimeScopeId,
      queryClient,
      invalidateProject,
      invalidateTasks,
      invalidateProjects,
      terminals,
      cliAvailability,
      showAgentUpdateRequired,
    ]
  );

  // The session a fresh one should anchor on: the grid cell the user is looking
  // at, falling back to the scope's active session. Clone and "new session" both
  // use it so a new session lands beside — and takes focus from — that pane.
  const anchorSessionId = useCallback((): string | undefined => {
    // Live DOM focus first (a hotkey fires with a cell focused); then the grid's
    // last-focused cell reported to the store (a header-button click moved DOM
    // focus to the button); finally the scope's active session.
    for (const candidate of [readFocusedGridTaskId(), terminals.getGridFocusedTaskId()]) {
      if (candidate && tasks.some((t) => t.id === candidate)) return candidate;
    }
    return terminals.activeFor(selectedScopeKey)?.taskId ?? undefined;
  }, [tasks, terminals, selectedScopeKey]);

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
    // Drop the new session beside the active one and focus it, like Clone.
    const anchor = anchorSessionId();
    if (anchor) terminals.requestCloneInsertAfter(anchor);
    createSession(
      {
        agent: project.savedAgent,
        branch: project.branch || DEFAULT_BRANCH,
        skipPermissions: !!project.savedSkipPermissions,
        bareSession: project.savedAgent === "claude-code" ? !!project.savedBareSession : false,
      },
      { focusOnCreate: true },
    );
  }, [project, createSession, cliAvailability, showAgentUpdateRequired, anchorSessionId, terminals]);

  const startWithSavedInNewRow = useCallback(() => {
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
    // Start session in a fresh grid row instead of beside the active one.
    terminals.requestNewRow();
    createSession(
      {
        agent: project.savedAgent,
        branch: project.branch || DEFAULT_BRANCH,
        skipPermissions: !!project.savedSkipPermissions,
        bareSession: project.savedAgent === "claude-code" ? !!project.savedBareSession : false,
      },
      { focusOnCreate: true },
    );
  }, [project, createSession, cliAvailability, showAgentUpdateRequired, terminals]);

  // Launch a whole batch of sessions shaped rows×cols (the "new session grid"
  // dialog). The column count becomes the scope's sessions-per-row lock — the
  // grid reflows to it and the arriving batch stacks into fresh rows of that
  // width (via the store's session-batch claim), so the result is the shape
  // the user picked rather than sessions appended wherever the anchor sits.
  const startSessionsInGrid = useCallback(
    ({ agent, rows, cols }: { agent: TaskAgent; rows: number; cols: number }) => {
      if (!project) return;
      const availability = availabilityFor(cliAvailability, agent);
      if (availability.status === "outdated") {
        showAgentUpdateRequired(agent, availability);
        return;
      }
      saveGridColumnLimit(selectedScopeKey, cols);
      const count = rows * cols;
      terminals.requestSessionBatch(selectedScopeKey, count);
      // Reuse the remembered per-agent settings when they describe this agent;
      // a different agent starts with the safe defaults.
      const savedMatches = !!(project.rememberAgentSettings && project.savedAgent === agent);
      const payload = {
        agent,
        branch: project.branch || DEFAULT_BRANCH,
        skipPermissions: savedMatches ? !!project.savedSkipPermissions : false,
        bareSession:
          agent === "claude-code" && savedMatches ? !!project.savedBareSession : false,
      };
      for (let i = 0; i < count; i++) {
        void createSession(payload, { focusOnCreate: i === 0 });
      }
    },
    [
      project,
      cliAvailability,
      showAgentUpdateRequired,
      selectedScopeKey,
      terminals,
      createSession,
    ],
  );

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

  // New-row variant of agent.new: the session lands in a fresh grid row at the
  // bottom instead of beside the active one. Grid-only — rows don't exist
  // outside the grid.
  const onNewRowPrimary = useCallback(() => {
    if (!projectPathReady) return;
    if (showNewAgent || showEdit) return;
    if (project?.rememberAgentSettings && project.savedAgent) {
      void startWithSavedInNewRow();
      return;
    }
    setNewAgentTarget("newRow");
    setShowNewAgent(true);
  }, [project, projectPathReady, showNewAgent, showEdit, startWithSavedInNewRow]);

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
      if (fileFinderOpen) setFileFinderOpen(false);
      else openFileFinderFresh();
    },
  );

  // Start an agent session seeded with a spoken task (voice control). When the
  // user didn't name a harness, use Settings -> Defaults.
  const startVoiceAgent = useCallback(
    (prompt: string, agent?: TaskAgent) => {
      if (!project || !projectPathReady) return;
      // Voice-seeded prompts only flow through the local cold-spawn path; remote
      // sandbox sessions spawn via remotePty (no initialInput) and would drop it.
      if (activeRuntimeScopeId !== LOCAL_SCOPE_ID) {
        toast.error("Voice agents aren't supported in sandbox sessions yet.");
        return;
      }
      const payload = defaultSessionPayload(project);
      // Drop the new session beside the active one and focus it, like Clone.
      const anchor = anchorSessionId();
      if (anchor) terminals.requestCloneInsertAfter(anchor);
      void createSession(
        { ...payload, agent: agent ?? settings?.defaultAgent ?? "claude-code", bareSession: false },
        { initialInput: prompt, focusOnCreate: true },
      );
    },
    [
      project,
      projectPathReady,
      activeRuntimeScopeId,
      createSession,
      settings?.defaultAgent,
      anchorSessionId,
      terminals,
    ],
  );

  // Ship: open an AI session that pushes/syncs with remote using Settings → Defaults → Ship.
  const startShipSession = useCallback(() => {
    if (!project || !projectPathReady) return;
    if (activeRuntimeScopeId !== LOCAL_SCOPE_ID) {
      toast.error("Ship isn't supported in sandbox sessions yet.");
      return;
    }
    const payload = defaultSessionPayload(project);
    const anchor = anchorSessionId();
    if (anchor) terminals.requestCloneInsertAfter(anchor);
    void createSession(
      {
        ...payload,
        agent: settings?.shipAgent ?? "claude-code",
        bareSession: false,
      },
      {
        initialInput: settings?.shipPrompt ?? DEFAULT_SHIP_PROMPT,
        focusOnCreate: true,
        model: settings?.shipModel ?? null,
      },
    );
  }, [
    project,
    projectPathReady,
    activeRuntimeScopeId,
    createSession,
    settings?.shipAgent,
    settings?.shipModel,
    settings?.shipPrompt,
    anchorSessionId,
    terminals,
  ]);

  // Command bus: VoiceController (mounted at root) dispatches these for the
  // active project route to perform. Mirrors the project.runToggle hotkey.
  useEffect(() => {
    const onRun = () => {
      if (
        showNewAgent ||
        showEdit ||
        confirmRemove ||
        projectPathIssue ||
        projectPathCheck.state === "error"
      ) {
        return;
      }
      if (hasRunningLaunch) {
        if (!stopping) void stopLaunch();
      } else if (!launching) {
        void runLaunch();
      }
    };
    const onNewAgent = (e: Event) => {
      const detail = (e as CustomEvent<VoiceNewAgentDetail>).detail;
      startVoiceAgent(detail?.prompt ?? "", detail?.agent);
    };
    const onOpenBrowser = () => {
      if (!project?.launchUrl) {
        toast.error("No launch URL configured for this project.");
        return;
      }
      void openExternal(project.launchUrl);
    };
    const onRunScript = (e: Event) => {
      const detail = (e as CustomEvent<VoiceRunScriptDetail>).detail;
      const script = customScripts.find((s) => s.id === detail?.scriptId);
      if (script) runScript(script);
    };
    const onOpenDiff = () => {
      if (projectPathReady) setDiffViewOpen(true);
    };
    const onRemember = (e: Event) => {
      const text = (e as CustomEvent<VoiceRememberDetail>).detail?.text?.trim();
      if (!text) return;
      // A spoken fact is a user-confirmed discovery. Long dictations overflow the
      // title, so clamp to its limit — the whole utterance still reads as one line.
      const title = text.slice(0, MEMORY_TITLE_MAX);
      void api
        .createMemory(id, { type: "discovery", title, source: "voice", confidence: "confirmed" })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.projectMemory(id) });
          toast.success(`Remembered: “${title}”`);
        })
        .catch((err) =>
          toast.error(err instanceof Error ? err.message : "Could not save that memory"),
        );
    };
    window.addEventListener(VOICE_RUN_PROJECT_EVENT, onRun);
    window.addEventListener(VOICE_NEW_AGENT_EVENT, onNewAgent as EventListener);
    window.addEventListener(VOICE_OPEN_BROWSER_EVENT, onOpenBrowser);
    window.addEventListener(VOICE_RUN_SCRIPT_EVENT, onRunScript as EventListener);
    window.addEventListener(VOICE_OPEN_DIFF_EVENT, onOpenDiff);
    window.addEventListener(VOICE_REMEMBER_EVENT, onRemember as EventListener);
    return () => {
      window.removeEventListener(VOICE_RUN_PROJECT_EVENT, onRun);
      window.removeEventListener(VOICE_NEW_AGENT_EVENT, onNewAgent as EventListener);
      window.removeEventListener(VOICE_OPEN_BROWSER_EVENT, onOpenBrowser);
      window.removeEventListener(VOICE_RUN_SCRIPT_EVENT, onRunScript as EventListener);
      window.removeEventListener(VOICE_OPEN_DIFF_EVENT, onOpenDiff);
      window.removeEventListener(VOICE_REMEMBER_EVENT, onRemember as EventListener);
    };
  }, [
    showNewAgent,
    showEdit,
    confirmRemove,
    projectPathIssue,
    projectPathCheck.state,
    hasRunningLaunch,
    stopping,
    launching,
    stopLaunch,
    runLaunch,
    startVoiceAgent,
    project,
    customScripts,
    runScript,
    projectPathReady,
    setDiffViewOpen,
    id,
    queryClient,
  ]);

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
    showInstallShipSkill ||
    showLaunchEmpty ||
    confirmDeleteArchived ||
    !!projectPathIssue ||
    projectPathCheck.state === "error" ||
    showCodexHooksNotice ||
    agentUpdateRequired !== null;

  const cycleSession = useCallback(
    (direction: 1 | -1) => {
      if (!project || !terminalProject) return;
      if (anyBlockingDialogOpen) return;
      // When the grid is on screen it cycles by moving the focused cell through
      // the on-screen layout, which SessionGrid owns (it tracks "current" via
      // terminal focus, not the scope's active-session state that toggle() below
      // mutates). Let its own session.cycleNext/cyclePrev handlers drive it so
      // cycling is visible. Guard on showGrid (not gridViewActive) so the
      // empty-grid fallback — where SessionGrid isn't mounted — still falls
      // through to the normal cycle here. The grid stays mounted alongside the
      // docked diff panel, so cycling stays grid-owned while reviewing changes.
      if (showGrid) return;
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
    [
      project,
      terminalProject,
      selectedScopeKey,
      tasks,
      terminals,
      anyBlockingDialogOpen,
      showGrid,
    ],
  );

  const duplicateActiveSession = useCallback(
    (sourceTaskId?: string) => {
      if (!project) return;
      if (anyBlockingDialogOpen) return;
      // Resolve which session to clone, most-specific first:
      //  1. The session whose "Clone" button fired the event (menu path).
      //  2. The grid cell that currently holds focus — the pane the user is
      //     actually looking at when they hit Cmd+D. Without this the
      //     keyboard path anchors on the scope's tracked-active session, which
      //     in a multi-pane grid is often a different cell, so the clone lands
      //     beside the "wrong" session (or, if that session isn't in the
      //     rendered layout, in a seemingly random spot).
      //  3. The scope's active session (non-grid view / no cell focused).
      const focusedGridTaskId = readFocusedGridTaskId();
      const sourceTask =
        (sourceTaskId && tasks.find((t) => t.id === sourceTaskId)) ||
        (focusedGridTaskId && tasks.find((t) => t.id === focusedGridTaskId)) ||
        (() => {
          const active = terminals.activeFor(selectedScopeKey);
          return active ? tasks.find((t) => t.id === active.taskId) : undefined;
        })();
      if (!sourceTask) return;
      // In grid view, drop the clone directly beside the session it came from
      // rather than at the end of the grid.
      terminals.requestCloneInsertAfter(sourceTask.id);
      void createSession(
        {
          agent: sourceTask.agent,
          branch: sourceTask.branch || project.branch || DEFAULT_BRANCH,
          skipPermissions: !!sourceTask.claudeSkipPermissions,
          bareSession: sourceTask.agent === "claude-code" ? !!sourceTask.claudeBareSession : false,
        },
        { focusOnCreate: true },
      );
    },
    [project, selectedScopeKey, tasks, terminals, createSession, anyBlockingDialogOpen],
  );
  const duplicateActiveSessionRef = useRef(duplicateActiveSession);
  duplicateActiveSessionRef.current = duplicateActiveSession;

  // Session cycling + clone go through the rebindable registry so a rebind in
  // Keybindings settings actually takes effect here (matches focus mode, which
  // wires the same actions via useHotkey). Capture phase mirrors the old direct
  // listener — a focused xterm textarea would otherwise swallow the chord first.
  // The shifted-bracket combos (Cmd+Shift+] → e.key "}") are resolved by
  // matchBinding's e.code fallback, so no manual e.code handling is needed.
  useHotkey("session.cycleNext", () => cycleSession(1), { capture: true });
  useHotkey("session.cyclePrev", () => cycleSession(-1), { capture: true });
  useHotkey("session.clone", () => duplicateActiveSession(), { capture: true });
  useHotkey("screenshot.capture", () => void captureScreenshot(), {
    capture: true,
    enabled: screenshotSupported,
  });
  useHotkey(
    "session.newRow",
    () => {
      if (anyBlockingDialogOpen) return;
      onNewRowPrimary();
    },
    { capture: true, enabled: gridViewActive },
  );

  // The per-session "Clone" menu button dispatches this to clone a specific
  // session by id (registered once, so it reads the latest handler via a ref).
  useEffect(() => {
    const onDuplicateRequest = (e: Event) => {
      const taskId = (e as CustomEvent<{ taskId?: string }>).detail?.taskId;
      duplicateActiveSessionRef.current(taskId);
    };
    window.addEventListener(DUPLICATE_ACTIVE_SESSION_EVENT, onDuplicateRequest);
    return () => window.removeEventListener(DUPLICATE_ACTIVE_SESSION_EVENT, onDuplicateRequest);
  }, []);

  // Capture phase (and no ignoreEditable) so Review Changes toggles even while a
  // session terminal is focused. In grid view a cell's xterm always holds focus,
  // so the old bubble-phase, editable-guarded listener never fired there — the
  // xterm swallowed the chord and the editable guard bailed out. Matches how
  // session.gridView / cycle are wired.
  useHotkey(
    "git.diff",
    () => {
      if (anyBlockingDialogOpen || !projectPathReady) return;
      onToggleDiffView();
    },
    { capture: true },
  );

  // Capture phase so a focused session terminal can't swallow the key first —
  // this must flip in/out of the grid even while typing in a session.
  useHotkey(
    "session.gridView",
    () => {
      if (anyBlockingDialogOpen) return;
      toggleGridViewShowingAll();
    },
    { capture: true },
  );

  // Enter Focused Session Mode (small floating window). Target resolution
  // mirrors clone: the focused grid cell first, then the scope's active
  // session. Capture phase so a focused xterm can't swallow the key. Key
  // repeats are ignored — a held toggle chord repeating across the exit
  // navigation would land here and immediately re-enter focus mode.
  useHotkey(
    "session.focusMode",
    (e) => {
      if (e.repeat || anyBlockingDialogOpen) return;
      const focusedGridTaskId = readFocusedGridTaskId();
      const taskId =
        (focusedGridTaskId && tasks.some((t) => t.id === focusedGridTaskId && !t.archived)
          ? focusedGridTaskId
          : null) ?? terminals.activeFor(selectedScopeKey)?.taskId;
      if (!taskId) return;
      enterFocusSession(router, taskId);
    },
    { capture: true },
  );

  const hiddenSession = lastHiddenSessionRef.current;
  const canRestoreHiddenSession =
    !!project &&
    hiddenSession?.projectId === selectedScopeKey &&
    terminals.sessions.some(
      (s) =>
        s.taskId === hiddenSession.taskId &&
        `${worktreeScopeKey(s.project.id, s.project.activeWorktreeId)}:${s.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}` ===
          selectedScopeKey,
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
      // On screen, the grid owns terminal.close: it hides the focused cell's
      // session (SessionGrid's handleHideIntent) instead of toggling the single
      // active panel this handler tracks. Guard on showGrid (not gridViewActive)
      // so the empty-grid fallback — where SessionGrid isn't mounted — still
      // falls through to the panel hide here. Mirrors cycleSession.
      if (showGrid) return;
      const active = terminals.activeFor(selectedScopeKey);
      if (active) {
        lastHiddenSessionRef.current = { projectId: selectedScopeKey, taskId: active.taskId };
        terminals.deselect(selectedScopeKey);
        return;
      }
      const hidden = lastHiddenSessionRef.current;
      if (!hidden || hidden.projectId !== selectedScopeKey) return;
      const sessionStillOpen = terminals.sessions.some(
        (s) =>
          s.taskId === hidden.taskId &&
          `${worktreeScopeKey(s.project.id, s.project.activeWorktreeId)}:${s.project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}` ===
            selectedScopeKey,
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

  // Coalesce bursts of task events for THIS project into a single refetch. A
  // running agent emits many task:updated events per second; each used to
  // refetch this project's tasks + detail + the global projects list. The
  // sidebar (ProjectBar / ProjectPicker) owns the projects-list refresh, so
  // this route only refetches its own tasks + detail — and ignores task events
  // for other projects entirely.
  const invalidateThisProjectTasks = useDebouncedCallback(() => {
    void invalidateTasks();
    void invalidateProject();
  }, 150);

  useServerEvents(
    useCallback(
      (e) => {
        applyQuestionServerEvent(e);
        if (e.type.startsWith("task:")) {
          if (e.projectId === id) {
            invalidateThisProjectTasks();
            // Badge dots on non-selected worktrees come from the worktrees query.
            void invalidateWorktrees();
          }
        } else if (e.type.startsWith("worktree:")) {
          void invalidateWorktrees();
          void invalidateProject();
        } else if (e.type.startsWith("project:")) {
          void invalidateProject();
          void invalidateProjects();
        } else if (e.type.startsWith("memory:")) {
          if (e.projectId === id) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.projectMemory(id) });
            // Non-blocking review nudge for silent auto-capture (D3): deep-links
            // into the Recall panel's Recently-learned filter for bulk keep/edit.
            if (e.type === "memory:learned" && (settings?.recallLearnedToastEnabled ?? true)) {
              const count = typeof e.count === "number" ? e.count : 0;
              if (count > 0) {
                toast.success(
                  `Learned ${count} ${count === 1 ? "memory" : "memories"} from this session`,
                  {
                    action: {
                      label: "Review",
                      onClick: () => {
                        setRecallInitialFilter("recent");
                        setShowRecall(true);
                      },
                    },
                  },
                );
              }
            }
          }
        }
      },
      [id, invalidateThisProjectTasks, invalidateProject, invalidateProjects, invalidateWorktrees, queryClient, settings?.recallLearnedToastEnabled]
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

  const activeTasks = tasks.filter((t) => !t.archived);
  const pinnedTasks = activeTasks.filter((t) => t.pinned);
  const archivedTasks = tasks.filter((t) => t.archived);
  const visibleTasks = showArchived ? archivedTasks : showPinned ? pinnedTasks : activeTasks;
  // Active list peels pinned into a top "Pinned" section; Pinned tab keeps
  // normal status grouping (already all-pinned). Archived folds ready into the
  // Archived column so a Ready section never appears there.
  const activeListGroups =
    !showArchived && !showPinned ? groupActiveListTasksForDisplay(visibleTasks) : null;
  const tasksByStatus = activeListGroups
    ? activeListGroups.byStatus
    : showArchived
      ? groupArchivedTasksForDisplay(visibleTasks)
      : groupTasksByStatusForDisplay(visibleTasks);
  const pinnedListTasks = activeListGroups?.pinned ?? [];

  const activeId = terminals.activeTaskIdFor(selectedScopeKey);
  const pathIssueIsWorktree = projectPathIssue?.scope === "worktree";
  const setTaskPinning = (taskId: string, pinning: boolean) => {
    setPinningTaskIds((current) => {
      if (pinning && current.has(taskId)) return current;
      if (!pinning && !current.has(taskId)) return current;
      const next = new Set(current);
      if (pinning) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  };

  // Card click opens/focuses a session. Re-clicking the active card must not
  // hide the panel — only the session panel close button (or terminal.close
  // hotkey) deselects.
  const selectTerminal = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !terminalProject) return;
    terminals.openSession(terminalProject, task);
  };

  const toggleSessionPinned = async (taskId: string) => {
    if (!project) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.archived) return;
    const nextPinned = !task.pinned;
    const previousPinned = task.pinned;
    const requestId = (pinRequestSeqRef.current[taskId] ?? 0) + 1;
    pinRequestSeqRef.current[taskId] = requestId;
    setTaskPinning(taskId, true);

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId, activeRuntimeScopeId);
    await queryClient.cancelQueries({ queryKey: tasksKey });
    setTaskPinnedInCache(
      queryClient,
      project.id,
      selectedWorktreeId,
      taskId,
      nextPinned,
      activeRuntimeScopeId,
    );

    try {
      const saved = await api.updateTask(taskId, { pinned: nextPinned });
      if (pinRequestSeqRef.current[taskId] !== requestId) return;
      queryClient.setQueryData<Task[]>(tasksKey, (current) =>
        (current ?? []).map((t) =>
          t.id === taskId
            ? {
                ...t,
                pinned: saved.task.pinned,
                updatedAt: saved.task.updatedAt,
              }
            : t,
        ),
      );
      void invalidateTasks();
    } catch (e: unknown) {
      if (pinRequestSeqRef.current[taskId] === requestId) {
        const currentTask = queryClient.getQueryData<Task[]>(tasksKey)?.find((t) => t.id === taskId);
        if (currentTask?.pinned === nextPinned) {
          setTaskPinnedInCache(
            queryClient,
            project.id,
            selectedWorktreeId,
            taskId,
            previousPinned,
            activeRuntimeScopeId,
          );
        }
        void invalidateTasks();
        toast.error(e instanceof Error ? e.message : "Could not update pinned session");
      }
    } finally {
      if (pinRequestSeqRef.current[taskId] === requestId) {
        delete pinRequestSeqRef.current[taskId];
        setTaskPinning(taskId, false);
      }
    }
  };

  const deleteTask = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !project) return;

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId, activeRuntimeScopeId);
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

    removeTaskFromCache(queryClient, project.id, selectedWorktreeId, taskId, activeRuntimeScopeId);

    void (async () => {
      try {
        await terminals.close(
          taskId,
          isActive ? { activateTaskId: next?.id ?? null } : undefined,
        );
        await api.deleteTask(taskId);
        void refresh();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks, activeRuntimeScopeId);
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not update this project path";
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not remove project";
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
    } catch (e: unknown) {
      setProjectPathCheck({
        state: "error",
        message: e instanceof Error ? e.message : "Could not verify this project path.",
      });
    } finally {
      setRetryingProjectPath(false);
    }
  };

  const closePathIssue = () => {
    router.navigate({ to: "/" });
  };

  // Archive one or more active sessions: kill each tty, flip the archived flag,
  // and repoint the terminal panel if the active session is being archived.
  // No confirmation — archiving is reversible via Restore.
  const archiveTasks = (targets: Task[]) => {
    if (!project || targets.length === 0) return;
    const ids = new Set(targets.map((t) => t.id));

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId, activeRuntimeScopeId);
    void queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);

    const activeTaskId = terminals.activeTaskIdFor(selectedScopeKey);
    const archivingActive = !!activeTaskId && ids.has(activeTaskId);
    const next = archivingActive
      ? pickByPriority(tasks.filter((t) => !t.archived && !ids.has(t.id)))
      : undefined;

    // Repoint the panel at the replacement session before the PTY is torn down,
    // mirroring deleteTask so the panel doesn't briefly unmount.
    if (archivingActive && terminalProject) {
      if (next) terminals.openSession(terminalProject, next);
      else terminals.deselect(selectedScopeKey);
    }

    setTasksArchivedInCache(queryClient, project.id, selectedWorktreeId, ids, true, activeRuntimeScopeId);

    void (async () => {
      try {
        await Promise.all(
          targets.map(async (t) => {
            await terminals
              .close(
                t.id,
                t.id === activeTaskId ? { activateTaskId: next?.id ?? null } : undefined,
              )
              .catch(() => undefined);
            await api.archiveTask(t.id);
          }),
        );
        void refresh();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks, activeRuntimeScopeId);
        }
        toast.error(e instanceof Error ? e.message : "Could not archive session");
      }
    })();
  };

  const archiveSession = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) archiveTasks([task]);
  };
  archiveSessionRef.current = archiveSession;

  // Archive every open session shown in the grid (across all projects). Used by
  // the grid-view header's "Archive all" action. Plain function (not a hook)
  // because it lives after this component's early returns.
  const archiveAllGridSessions = async () => {
    // Only archive the sessions shown in this project/scope's grid, not every
    // open session across all projects.
    const openSessions = terminals.sessions.filter(
      (s) => scopeKeyForProject(s.project) === selectedScopeKey,
    );
    if (openSessions.length === 0) return;
    const results = await Promise.allSettled(
      openSessions.map((session) =>
        archiveOpenSession(session, terminals.close, queryClient, { skipInvalidate: true }),
      ),
    );
    // One deduped invalidation pass instead of a per-session fan-out (the
    // global projects key alone would otherwise be invalidated N times).
    await invalidateSessionQueries(queryClient, openSessions);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      toast.error(
        failed === openSessions.length
          ? "Could not archive sessions"
          : `Archived ${openSessions.length - failed} of ${openSessions.length} sessions`,
      );
    }
  };

  const restoreSession = (taskId: string) => {
    if (!project) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId, activeRuntimeScopeId);
    void queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
    setTaskArchivedInCache(queryClient, project.id, selectedWorktreeId, taskId, false, activeRuntimeScopeId);

    void (async () => {
      try {
        await api.restoreTask(taskId);
        void refresh();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks, activeRuntimeScopeId);
        }
        toast.error(e instanceof Error ? e.message : "Could not restore session");
      }
    })();
  };

  const deleteAllArchived = () => {
    setConfirmDeleteArchived(false);
    if (!project) return;
    const archived = tasks.filter((t) => t.archived);
    if (archived.length === 0) return;

    const tasksKey = queryKeys.tasks(project.id, selectedWorktreeId, activeRuntimeScopeId);
    void queryClient.cancelQueries({ queryKey: tasksKey });
    const previousTasks = queryClient.getQueryData<Task[]>(tasksKey);
    const archivedIds = new Set(archived.map((t) => t.id));
    removeTasksFromCache(queryClient, project.id, selectedWorktreeId, archivedIds, activeRuntimeScopeId);

    void (async () => {
      try {
        await Promise.all(
          archived.map(async (t) => {
            await terminals.close(t.id).catch(() => undefined);
            await api.deleteTask(t.id);
          }),
        );
        void refresh();
      } catch (e: unknown) {
        if (previousTasks) {
          restoreTasksCache(queryClient, project.id, selectedWorktreeId, previousTasks, activeRuntimeScopeId);
        }
        toast.error(e instanceof Error ? e.message : "Could not delete archived sessions");
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
    if (newAgentTarget === "newRow") {
      // The "New row" button asked for this session to start a fresh grid row.
      terminals.requestNewRow();
    } else {
      // Default: drop the new session beside the active one, like Clone.
      const anchor = anchorSessionId();
      if (anchor) terminals.requestCloneInsertAfter(anchor);
    }
    setNewAgentTarget("default");
    createSession(
      {
        agent: data.agent,
        branch: data.branch,
        skipPermissions: data.dangerouslySkipPermissions,
        bareSession: data.bareSession,
      },
      { focusOnCreate: true },
    );
  };

  const headerActions = (
    <HeaderActions>
      {/* Single context→actions divider: the one boundary between "which
       * project / scope" and the actions performed on it. */}
      <span
        aria-hidden
        style={{
          width: 1,
          height: 18,
          background: "var(--border)",
          margin: "0 4px",
          flexShrink: 0,
        }}
      />
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
      {worktreesEnabled && (
        // "New worktree" now lives inside the branch dropdown (below), so the
        // standalone create-worktree button is gone — one fewer control, and no
        // second accent competing with Ship.
        <>
          {/* Separate Run (launch the app) from the git group (branch / changes
           * / ship) — two different concerns. */}
          <span
            aria-hidden
            style={{
              width: 1,
              height: 18,
              background: "var(--border)",
              margin: "0 4px",
              flexShrink: 0,
            }}
          />
          <WorktreeToggleGroup
          worktrees={worktrees}
          selectedId={selectedWorktree?.id ?? MAIN_WORKTREE_ID}
          runningKeys={launchRunningWorktreeIds}
          projectId={project.id}
          onSelect={selectWorktree}
          onDeleteSelected={() => setConfirmDeleteWorktree(true)}
          mainBranchLabel={gitStatus?.branch}
          mainBranchUnavailable={gitUnavailable}
          mainBranchUnavailableTitle={gitUnavailableMessage ?? undefined}
          branchSwitchDisabled={projectPathBlocked}
          changedCount={gitStatus?.changedCount}
          onToggleDiffView={onToggleDiffView}
          shipDisabled={projectPathBlocked}
          shipEnabled={projectPathUsable}
          onShip={startShipSession}
          onCreateWorktree={() => void createProjectWorktree()}
          createWorktreeDisabled={creatingWorktree || projectPathBlocked || gitUnavailable}
          createWorktreeTitle={
            projectPathBlocked
              ? "Project folder unavailable"
              : gitUnavailableMessage || "Create a new worktree"
          }
            maxWidth="min(520px, 42vw)"
          />
        </>
      )}
    </HeaderActions>
  );

  // Grid-view toggle sits in the top bar beside prompt history (the
  // before-search slot), a session view mode kept out of the run/git actions.
  const headerBeforeSearch = (
    <HeaderBeforeSearch>
      <HotkeyTooltip
        action="session.gridView"
        label={terminals.gridView ? "Exit grid view" : "Grid view — show all sessions"}
      >
        <Btn
          variant="ghost"
          onClick={toggleGridViewShowingAll}
          aria-label={terminals.gridView ? "Exit grid view" : "Grid view — show all sessions"}
          aria-pressed={terminals.gridView}
          style={{
            background: terminals.gridView ? "var(--surface-2)" : undefined,
            color: terminals.gridView ? "var(--text)" : undefined,
          }}
        >
          <GridViewToggleIcon gridView={terminals.gridView} />
        </Btn>
      </HotkeyTooltip>
    </HeaderBeforeSearch>
  );

  return (
    <>
      <CursorGlow />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: showGrid ? "hidden" : "auto",
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
        className="dot-grid-bg"
      >
      <CardFrame
        className="mc-project-frame"
        style={{
          width: "100%",
          minHeight: showGrid ? 0 : "100%",
          flex: showGrid ? 1 : undefined,
          flexShrink: showGrid ? undefined : 0,
          boxSizing: "border-box",
          padding: 8,
          display: showGrid ? "flex" : undefined,
          flexDirection: showGrid ? "column" : undefined,
          overflow: showGrid ? "hidden" : undefined,
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
            margin: showGrid ? "-8px -8px 12px" : "-8px -8px 32px",
            padding: "22px 24px 18px",
            position: "relative",
            isolation: "isolate",
            zIndex: 2,
          }}
        >
          <div ref={overflowRef} style={{ position: "relative", flex: "0 0 auto", display: "inline-flex", alignItems: "center" }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setOverflowOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOverflowOpen((v) => !v);
                }
              }}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label={`${project.name} project actions`}
              title={project.name}
              className="mc-project-header-trigger"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px 6px 6px",
                color: "var(--text)",
                cursor: "pointer",
                borderRadius: 10,
                flexShrink: 0,
              }}
            >
              <ProjectIcon project={project} size={32} />
              <Icon
                name="chevron-down"
                size={14}
                style={{
                  color: "var(--text-dim)",
                  flexShrink: 0,
                  transform: overflowOpen ? "rotate(180deg)" : undefined,
                  transition: "transform 120ms ease",
                }}
              />
            </div>
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
                  boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
                  zIndex: Z_INDEX.popover,
                }}
              >
                {hasRunningLaunch ? (
                  <>
                    <HotkeyTooltip action="project.runToggle">
                      <DropdownMenuItem
                        icon="x"
                        onClick={stopLaunch}
                        disabled={stopping}
                      >
                        {stopping ? "Stopping…" : "Stop launch"}
                      </DropdownMenuItem>
                    </HotkeyTooltip>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem
                  icon={project.pinned ? "pin-fill" : "pin"}
                  onClick={toggleProjectPin}
                  disabled={pinning}
                >
                  {pinning
                    ? project.pinned
                      ? "Unpinning..."
                      : "Pinning..."
                    : project.pinned
                      ? "Unpin project"
                      : "Pin project"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon="folder"
                  onClick={() => {
                    setOverflowOpen(false);
                    window.electronAPI?.openPath(selectedWorktreePath || project.path);
                  }}
                  title={selectedWorktreePath || project.path}
                >
                  Reveal in Finder
                </DropdownMenuItem>
                <HotkeyTooltip action="file.finder">
                  <DropdownMenuItem
                    icon="file-search"
                    onClick={() => {
                      setOverflowOpen(false);
                      openFileFinderFresh();
                    }}
                    disabled={projectPathBlocked}
                  >
                    Find file in project
                  </DropdownMenuItem>
                </HotkeyTooltip>
                {(settings?.recallEnabled ?? false) && (
                  <DropdownMenuItem
                    icon="sparkles"
                    onClick={() => {
                      setOverflowOpen(false);
                      setRecallInitialFilter("all");
                      setShowRecall(true);
                    }}
                    title="Recall — curated project memory fed to new sessions"
                  >
                    Recall
                  </DropdownMenuItem>
                )}
                {project.githubUrl ? (
                  <DropdownMenuItem
                    icon="github"
                    onClick={() => {
                      setOverflowOpen(false);
                      openExternal(project.githubUrl!);
                    }}
                  >
                    Open GitHub
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <HotkeyTooltip action="git.diff">
                  <DropdownMenuItem
                    icon="git-branch"
                    onClick={() => {
                      setOverflowOpen(false);
                      onToggleDiffView();
                    }}
                    disabled={projectPathBlocked}
                    title={
                      gitStatus && gitStatus.changedCount > 0
                        ? `${gitStatus.changedCount} changed file${gitStatus.changedCount === 1 ? "" : "s"}`
                        : gitStatus
                          ? "Review Changes"
                          : "Checking changes…"
                    }
                  >
                    Review Changes
                    {gitStatus && gitStatus.changedCount > 0 && (
                      <span style={{ color: "var(--text-dim)" }}>
                        {" · "}
                        {gitStatus.changedCount} changed
                      </span>
                    )}
                  </DropdownMenuItem>
                </HotkeyTooltip>
                <CreatePullRequestMenuItem
                  onSelect={() => {
                    setOverflowOpen(false);
                    void createPullRequest.onCreate();
                  }}
                  busy={createPullRequest.busy}
                />
                {worktreesEnabled ? (
                  <DropdownMenuItem
                    icon="terminal"
                    onClick={() => {
                      setOverflowOpen(false);
                      setShowWorktreeSetupConfig(true);
                    }}
                  >
                    Worktree init
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <InstallDiagramSkillMenuItem
                  onSelect={() => {
                    setOverflowOpen(false);
                    setShowInstallDiagramSkill(true);
                  }}
                />
                <InstallShipSkillMenuItem
                  onSelect={() => {
                    setOverflowOpen(false);
                    setShowInstallShipSkill(true);
                  }}
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon="play"
                  onClick={() => {
                    setOverflowOpen(false);
                    setShowLaunchConfig(true);
                  }}
                >
                  Launch commands
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon="terminal"
                  onClick={() => {
                    setOverflowOpen(false);
                    setShowCustomScriptsConfig(true);
                  }}
                >
                  Custom scripts
                </DropdownMenuItem>
                {showGrid && gridScopeSessionCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      icon="archive"
                      onClick={() => {
                        setOverflowOpen(false);
                        setConfirmArchiveAll(true);
                      }}
                      title="Archive all open sessions in this grid"
                    >
                      Archive all sessions
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <HotkeyTooltip action="project.edit">
                  <DropdownMenuItem
                    icon="settings"
                    onClick={() => {
                      setOverflowOpen(false);
                      setShowEdit(true);
                    }}
                  >
                    Edit project
                  </DropdownMenuItem>
                </HotkeyTooltip>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  danger
                  icon="trash"
                  onClick={() => {
                    setOverflowOpen(false);
                    setConfirmRemove(true);
                  }}
                  title="Remove this project from Mission Control. The folder on disk is not touched."
                >
                  Remove project
                </DropdownMenuItem>
              </CardFrame>,
              document.body,
            )}
          </div>
          <CustomScriptsButton
            scripts={customScripts}
            onRun={runScript}
            disabled={!projectPathUsable}
          />
          {showGrid && (
            <SessionScopeToggle
              view={sessionView}
              activeCount={activeTasks.length}
              pinnedCount={pinnedTasks.length}
              archivedCount={archivedTasks.length}
              showArchivedTab={hasArchivedTasks || showArchived}
              onChange={setSessionView}
            />
          )}
          {/* Grid arrangement (row width lock + sort) edits the persisted Active
           * layout, so it hides in the read-through Pinned tab — mirrors how the
           * grid disables reorder/resize there. */}
          {showGrid && !showPinned && (
            <GridLayoutButton scopeKey={selectedScopeKey} />
          )}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 6,
              flexWrap: "wrap",
              marginLeft: "auto",
              minWidth: 0,
            }}
          >
            {screenshotSupported && (
              <HotkeyTooltip
                action="screenshot.capture"
                label="Screenshot"
              >
                <Btn
                  variant="ghost"
                  icon="camera"
                  onClick={captureScreenshot}
                  aria-label="Capture a screenshot"
                  style={{ width: 40, minWidth: 40, paddingInline: 0 }}
                />
              </HotkeyTooltip>
            )}
            {headerActions}
            {headerBeforeSearch}
            <HotkeyTooltip action="file.finder" label="Find file">
              <Btn
                variant="ghost"
                icon="file-search"
                onClick={openFileFinderFresh}
                disabled={!projectPathUsable}
                aria-label="Find file in project"
                title={
                  projectPathBlocked
                    ? "Project folder unavailable"
                    : "Find file in project"
                }
                style={{ width: 40, minWidth: 40, paddingInline: 0 }}
              />
            </HotkeyTooltip>
            {!worktreesEnabled && (
              <div
                role="group"
                aria-label="Review changes and ship"
                className="mc-ship-group"
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
                  size="md"
                  variant={gitStatus?.changedCount === 0 ? "gray-frame" : "primary"}
                  splitTrailing
                  enabled={projectPathUsable}
                  onShip={startShipSession}
                />
              </div>
            )}
            {!showArchived && (
              <NewAgentButton
                project={project}
                onPrimary={onNewAgentPrimary}
                onNewRow={showGrid ? onNewRowPrimary : undefined}
                onNewGrid={
                  gridViewActive && !showArchived
                    ? () => {
                        if (projectPathReady) setShowNewSessionGrid(true);
                      }
                    : undefined
                }
                disabled={!projectPathReady}
                onConfigure={() => {
                  if (projectPathReady) setShowNewAgent(true);
                }}
              />
            )}
            {showArchived && archivedTasks.length > 0 && (
              <Btn
                variant="danger"
                icon="trash"
                onClick={() => setConfirmDeleteArchived(true)}
                title="Permanently delete all archived sessions"
              >
                Delete all
              </Btn>
            )}
          </div>
        </div>

        {showGrid ? (
          <SessionGrid
            scopeKey={selectedScopeKey}
            filter={showPinned ? "pinned" : "active"}
            pinnedTaskIds={pinnedTaskIds}
            onTogglePinned={toggleSessionPinned}
            pinningTaskIds={pinningTaskIds}
          />
        ) : (
        <>
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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 48,
            paddingInline: 12,
            boxSizing: "border-box",
          }}
        >
          {sandboxProvisioning && activeRuntimeSandbox ? (
            <SandboxProvisioningState
              name={activeRuntimeSandbox.name}
              deployJob={deployJob}
              deployLogText={deployLogText}
              remoteStatus={activeRuntimeSandbox.remoteStatus}
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
          ) : showArchived && visibleTasks.length === 0 ? (
            <EmptyState
              title="No archived sessions"
              subtitle="Archive a finished session to keep it around without cluttering your active list."
              icon="archive"
              action={
                <Btn variant="primary" icon="list" onClick={() => setSessionView("active")}>
                  View active
                </Btn>
              }
            />
          ) : showPinned && visibleTasks.length === 0 ? (
            <EmptyState
              title="No pinned sessions"
              subtitle="Pin sessions you want to keep an eye on, like loop runs."
              icon="pin"
              action={
                <Btn variant="primary" icon="terminal" onClick={() => setSessionView("active")}>
                  Back to active
                </Btn>
              }
            />
          ) : visibleTasks.length === 0 ? (
            <EmptyState
              title="No active sessions"
              subtitle="Start a new session to begin working on this project."
              action={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <NewAgentButton
                    project={project}
                    onPrimary={onNewAgentPrimary}
                    disabled={!projectPathReady}
                    onConfigure={() => {
                      if (projectPathReady) setShowNewAgent(true);
                    }}
                  />
                  {hasArchivedTasks && (
                    <Btn variant="ghost" icon="archive" onClick={() => setSessionView("archived")}>
                      View archived
                    </Btn>
                  )}
                </div>
              }
            />
          ) : (
            <>
              {pinnedListTasks.length > 0 && (
                <TaskColumn
                  key="pinned"
                  title="Pinned"
                  color="var(--accent)"
                  tasks={pinnedListTasks}
                  activeId={activeId}
                  onToggle={selectTerminal}
                  onArchive={archiveSession}
                  onTogglePinned={toggleSessionPinned}
                  pinningTaskIds={pinningTaskIds}
                />
              )}
              {STATUS_DISPLAY_ORDER.filter((s) => tasksByStatus[s].length > 0).map((status) => {
                const isArchivedTitleRow = showArchived && status === "finished";
                const firstArchivedStatus = showArchived
                  ? STATUS_DISPLAY_ORDER.find((s) => tasksByStatus[s].length > 0)
                  : undefined;
                // Prefer the "Archived" (finished) row; otherwise put the exit
                // control on the first visible archived status column.
                const showViewActive =
                  showArchived &&
                  (isArchivedTitleRow ||
                    (tasksByStatus.finished.length === 0 && status === firstArchivedStatus));
                return (
                <TaskColumn
                  key={status}
                  title={
                    isArchivedTitleRow
                      ? "Archived"
                      : STATUS_META[status].label
                  }
                  color={STATUS_META[status].color}
                  tasks={tasksByStatus[status]}
                  activeId={activeId}
                  onToggle={selectTerminal}
                  onArchive={showArchived ? undefined : archiveSession}
                  onRestore={showArchived ? restoreSession : undefined}
                  onDelete={showArchived ? deleteTask : undefined}
                  onTogglePinned={showArchived ? undefined : toggleSessionPinned}
                  pinningTaskIds={showArchived ? undefined : pinningTaskIds}
                  headerAction={
                    showViewActive ? (
                      <Btn
                        variant="ghost"
                        icon="list"
                        onClick={() => setSessionView("active")}
                        title="Back to active sessions"
                      >
                        View active
                      </Btn>
                    ) : !showArchived && status === "finished" && tasksByStatus.finished.length > 0 ? (
                      <Btn
                        variant="ghost"
                        icon="archive"
                        onClick={() => archiveTasks(tasksByStatus.finished)}
                        title="Archive all finished sessions"
                      >
                        Archive all
                      </Btn>
                    ) : !showArchived &&
                      status === "disconnected" &&
                      tasksByStatus.disconnected.length > 0 ? (
                      <Btn
                        variant="ghost"
                        icon="archive"
                        onClick={() => archiveTasks(tasksByStatus.disconnected)}
                        title="Archive all disconnected sessions"
                      >
                        Archive all
                      </Btn>
                    ) : undefined
                  }
                />
                );
              })}
              {!showArchived && hasArchivedTasks && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    paddingTop: 4,
                    paddingBottom: 12,
                  }}
                >
                  <Btn
                    variant="ghost"
                    icon="archive"
                    onClick={() => setSessionView("archived")}
                    title={`View ${archivedTasks.length} archived session${archivedTasks.length === 1 ? "" : "s"}`}
                  >
                    View archived
                  </Btn>
                </div>
              )}
            </>
          )}
        </div>
        </>
        )}
      </CardFrame>

      {screenshotSupported && <ScreenshotThumbnail projectId={id} />}

      <GitDiffModal
        open={showDiffView}
        projectId={project.id}
        worktreeId={selectedWorktreeId}
        projectPath={selectedWorktreePath || project.path}
        enabled={projectPathReady}
        onClose={closeDiffView}
        onShip={startShipSession}
      />

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
        onClose={() => {
          setShowNewAgent(false);
          setNewAgentTarget("default");
        }}
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

      <NewSessionGridDialog
        open={showNewSessionGrid}
        onClose={() => setShowNewSessionGrid(false)}
        cliAvailability={cliAvailability}
        defaultAgent={project.rememberAgentSettings ? project.savedAgent : null}
        onCreate={startSessionsInGrid}
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

      <RecallModal
        open={showRecall}
        onClose={() => setShowRecall(false)}
        projectId={project.id}
        projectName={project.name}
        initialFilter={recallInitialFilter}
      />

      <FileFinderDialog
        open={fileFinderOpen}
        projectRoot={selectedWorktreePath || project.path}
        resetKey={fileFinderResetKey}
        onClose={() => setFileFinderOpen(false)}
        onPick={(rel) => setOpenFileRel(rel)}
      />

      <FileEditorDialog
        projectRoot={selectedWorktreePath || project.path}
        relPath={openFileRel}
        onClose={() => setOpenFileRel(null)}
        onBack={() => {
          setOpenFileRel(null);
          setFileFinderOpen(true);
        }}
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

      <InstallShipSkillModal
        open={showInstallShipSkill}
        onClose={() => setShowInstallShipSkill(false)}
        projectPath={selectedWorktreePath || project.path}
        onRunInstall={runShipSkillInstallCommand}
      />

      <RemoveProjectConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={confirmRemoveProject}
        projectName={project.name}
        projectPath={project.path}
      />

      {selectedWorktree && !selectedWorktree.isMain && (
        <Modal
          open={confirmDeleteWorktree}
          onClose={closeDeleteWorktreeDialog}
          title={selectedWorktreeDirty ? "Delete dirty worktree" : "Delete worktree"}
          width={760}
          maxWidth="calc(100vw - 32px)"
          footerStyle={{ flexWrap: "nowrap", overflowX: "auto" }}
          footer={
            <>
              <StaticHotkeyTooltip hotkey="Esc">
                <Btn
                  variant="ghost"
                  onClick={closeDeleteWorktreeDialog}
                  disabled={deletingWorktree}
                >
                  Cancel
                </Btn>
              </StaticHotkeyTooltip>
              {selectedWorktreeDirty ? (
                <>
                  <Btn
                    variant="ghost"
                    icon="git-branch"
                    onClick={reviewSelectedWorktreeChanges}
                    disabled={deletingWorktree}
                  >
                    Review changes
                  </Btn>
                  <Btn
                    variant="primary"
                    icon="archive"
                    onClick={() => void deleteSelectedWorktree("stash")}
                    disabled={deletingWorktree}
                  >
                    {deletingWorktree ? "Deleting..." : "Stash and delete"}
                  </Btn>
                  <Btn
                    variant="danger"
                    icon="trash"
                    onClick={() => void deleteSelectedWorktree("discard")}
                    disabled={deletingWorktree || !worktreeDiscardConfirmMatches}
                  >
                    Discard and delete
                  </Btn>
                </>
              ) : (
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => void deleteSelectedWorktree("clean")}
                  disabled={deletingWorktree || selectedWorktreeStatusPending}
                >
                  {selectedWorktreeStatusPending
                    ? "Checking..."
                    : deletingWorktree
                      ? "Deleting..."
                      : "Delete"}
                </Btn>
              )}
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, color: "var(--text)" }}>
                Delete worktree &ldquo;{selectedWorktree.name}&rdquo;?
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                Mission Control will remove this worktree folder. The branch is kept.
              </div>
            </div>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface-0)",
                padding: "9px 11px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--text-dim)",
                lineHeight: 1.45,
                wordBreak: "break-all",
              }}
            >
              {selectedWorktree.path}
            </div>

            {selectedWorktreeStatusPending && (
              <div
                role="status"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--surface-0)",
                  padding: "9px 11px",
                  color: "var(--text-dim)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                Checking for uncommitted changes before delete is enabled.
              </div>
            )}

            {selectedWorktreeDirty && (
              <>
                <div
                  style={{
                    border: "1px solid color-mix(in srgb, var(--status-failed) 45%, transparent)",
                    borderRadius: 8,
                    background: "color-mix(in srgb, var(--status-failed) 10%, transparent)",
                    padding: "10px 12px",
                    color: "var(--text)",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  This worktree has {worktreeChangeLabel(selectedWorktreeChangeCount)}.
                  Review them, stash them before deletion, or type the worktree name to discard them.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                  }}
                >
                  <WorktreeChangeStat
                    label="Staged"
                    count={gitStatus?.staged.length ?? 0}
                  />
                  <WorktreeChangeStat
                    label="Unstaged"
                    count={gitStatus?.unstaged.length ?? 0}
                  />
                </div>
                {worktreeChangedFiles.length > 0 && (
                  <div
                    role="region"
                    aria-label="Changed files in worktree"
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--surface-0)",
                      maxHeight: WORKTREE_DELETE_FILES_MAX_HEIGHT,
                      overflowX: "hidden",
                      overflowY: "auto",
                    }}
                  >
                    {worktreeChangedFiles.map((file, index) => (
                      <div
                        key={`${file.area}:${file.status}:${file.path}:${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "92px minmax(0, 1fr)",
                          gap: 10,
                          padding: "7px 10px",
                          borderTop: index === 0 ? 0 : "1px solid var(--border)",
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          lineHeight: 1.35,
                        }}
                      >
                        <span style={{ color: "var(--text-faint)" }}>
                          {formatWorktreeChangeStatus(file.area, file.status)}
                        </span>
                        <span style={{ color: "var(--text-dim)", wordBreak: "break-all" }}>
                          {file.path}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <TextField
                  label="Discard confirmation"
                  value={worktreeDeleteConfirmName}
                  onChange={setWorktreeDeleteConfirmName}
                  placeholder={selectedWorktree.name}
                  mono
                  hint={`Type ${selectedWorktree.name} to enable Discard and delete.`}
                  ariaLabel={`Type ${selectedWorktree.name} to discard changes and delete the worktree`}
                />
              </>
            )}
          </div>
        </Modal>
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

      <ScriptArgsModal
        open={argsScript !== null}
        script={argsScript}
        onCancel={() => setArgsScript(null)}
        onRun={(resolvedCommand) => {
          const script = argsScript;
          setArgsScript(null);
          if (script) void executeScript(script, resolvedCommand);
        }}
      />

      <CustomScriptsDialog
        open={showCustomScriptsConfig}
        project={project}
        onClose={() => setShowCustomScriptsConfig(false)}
        onSave={(next) => {
          const projectKey = queryKeys.project(project.id);
          const previousProject = queryClient.getQueryData<Project>(projectKey);
          const serialized = serializeCustomScripts(next);
          queryClient.setQueryData<Project>(projectKey, (prev) =>
            prev ? { ...prev, customScripts: serialized, updatedAt: Date.now() } : prev,
          );
          void (async () => {
            try {
              const { project: updated } = await api.updateProject(project.id, {
                customScripts: next,
              });
              queryClient.setQueryData(projectKey, updated);
              void invalidateProjects();
            } catch (error) {
              queryClient.setQueryData(projectKey, previousProject);
              toast.error(
                error instanceof Error ? error.message : "Could not save custom scripts",
              );
            }
          })();
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
        open={confirmDeleteArchived}
        onClose={() => setConfirmDeleteArchived(false)}
        onConfirm={deleteAllArchived}
        title="Delete archived sessions"
        confirmLabel="Delete all"
        icon="trash"
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Permanently delete all archived sessions in &ldquo;{project.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {archivedTasks.length} archived session{archivedTasks.length === 1 ? "" : "s"} will be deleted. This cannot be undone. Active sessions are unaffected.
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmArchiveAll}
        onClose={() => setConfirmArchiveAll(false)}
        onConfirm={async () => {
          setArchivingAll(true);
          try {
            await archiveAllGridSessions();
          } finally {
            setArchivingAll(false);
            setConfirmArchiveAll(false);
          }
        }}
        title="Archive all sessions?"
        confirmLabel="Archive all"
        variant="danger"
        icon="archive"
        loading={archivingAll}
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 8 }}>
          Archive all {gridScopeSessionCount} open session
          {gridScopeSessionCount === 1 ? "" : "s"} in &ldquo;{project.name}&rdquo;?
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Any running sessions will be disconnected and their agents stopped. You
          can restore archived sessions later, but in-progress runs won&rsquo;t resume.
        </div>
      </ConfirmDialog>
      </div>
    </>
  );
}

function SessionScopeToggle({
  view,
  activeCount,
  pinnedCount,
  archivedCount,
  showArchivedTab,
  onChange,
}: {
  view: SessionView;
  activeCount: number;
  pinnedCount: number;
  archivedCount: number;
  showArchivedTab: boolean;
  onChange: (view: SessionView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const tabs: Array<{
    view: SessionView;
    label: string;
    count: number;
    icon: "terminal" | "pin-fill" | "archive";
  }> = [
    { view: "active", label: "Active", count: activeCount, icon: "terminal" },
    { view: "pinned", label: "Pinned", count: pinnedCount, icon: "pin-fill" },
  ];
  if (showArchivedTab) {
    tabs.push({ view: "archived", label: "Archived", count: archivedCount, icon: "archive" });
  }
  const current = tabs.find((tab) => tab.view === view) ?? tabs[0]!;

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({ top: rect.bottom + 6, left: rect.left });
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

  // If archived empties while that view is selected, the parent flips back to
  // active — close the menu so it doesn't linger over a removed option.
  useEffect(() => {
    if (!showArchivedTab && view !== "archived") setOpen(false);
  }, [showArchivedTab, view]);

  const select = (next: SessionView) => {
    setOpen(false);
    onChange(next);
  };

  return (
    <div ref={anchorRef} style={{ position: "relative", display: "inline-flex" }}>
      <Btn
        type="button"
        variant="ghost"
        icon={current.icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Show ${current.label.toLowerCase()} sessions, ${current.count}. Change session filter`}
        title={`${current.label} · ${current.count}`}
        onClick={() => setOpen((v) => !v)}
        style={{ paddingInline: 8 }}
      >
        <Icon
          name="chevron-down"
          size={11}
          style={{
            color: "var(--text-faint)",
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 120ms ease",
          }}
        />
      </Btn>
      {open &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="Show sessions by type"
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              minWidth: 180,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            {tabs.map((tab) => {
              const selected = view === tab.view;
              return (
                <DropdownMenuItem
                  key={tab.view}
                  icon={tab.icon}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => select(tab.view)}
                  style={
                    selected
                      ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" }
                      : undefined
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span style={{ flex: 1 }}>{tab.label}</span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {tab.count}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </CardFrame>,
          document.body,
        )}
    </div>
  );
}

function WorktreeBadgeDots({
  launchRunning,
  taskCounts,
}: {
  /** A launch command's terminal is running in this worktree. */
  launchRunning: boolean;
  taskCounts?: WorktreeInfo["taskCounts"];
}) {
  const statusDots = taskCounts ? getPinnedProjectStatusDots(taskCounts) : [];
  if (!launchRunning && statusDots.length === 0) return null;
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: -4,
        left: "50%",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {launchRunning && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0 6px var(--accent-glow)",
          }}
        />
      )}
      {statusDots.map((status, dot) => (
        <span
          key={`${status}-${dot}`}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: status === "running" ? "var(--accent)" : TASK_STATUS_META[status].color,
            boxShadow: status === "running" ? "0 0 5px var(--accent-glow)" : "none",
          }}
        />
      ))}
    </span>
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
  mainBranchUnavailable = false,
  mainBranchUnavailableTitle,
  branchSwitchDisabled = false,
  changedCount,
  onToggleDiffView,
  shipDisabled = false,
  shipEnabled = true,
  onShip,
  onCreateWorktree,
  createWorktreeDisabled = false,
  createWorktreeTitle,
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
  mainBranchUnavailable?: boolean;
  mainBranchUnavailableTitle?: string;
  branchSwitchDisabled?: boolean;
  changedCount?: number;
  onToggleDiffView: () => void;
  shipDisabled?: boolean;
  shipEnabled?: boolean;
  onShip: () => void;
  onCreateWorktree?: () => void;
  createWorktreeDisabled?: boolean;
  createWorktreeTitle?: string;
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
        // Horizontal scrollers clip vertical overflow, so the badge dots need
        // to live inside the scrollport instead of relying on z-index.
        padding: "7px 2px",
        flexShrink: 1,
      }}
    >
      {items.map((worktree) => {
        const selected = worktree.id === selectedId;
        const optimistic = isOptimisticWorktree(worktree);
        const worktreeKey = worktreeScopeKey(projectId, worktree.isMain ? null : worktree.id);
        const running = [...runningKeys].some(
          (key) => key === worktreeKey || key.startsWith(`${worktreeKey}:`),
        );
        const canDelete = selected && !worktree.isMain && !optimistic && !!onDeleteSelected;
        const label = worktree.isMain ? "main" : worktree.name;
        // Un-fused: Changes (quiet, review diff) and Ship (bold primary) read
        // as two distinct controls with hierarchy, not one welded segment.
        const shipControls = () => (
          <>
            <ProjectGitStatusButton
              changedCount={changedCount}
              onClick={onToggleDiffView}
              disabled={shipDisabled}
            />
            <CommitPushButton
              size="md"
              variant={changedCount === 0 ? "gray-frame" : "primary"}
              enabled={shipEnabled}
              onShip={onShip}
            />
          </>
        );
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
              <WorktreeBadgeDots launchRunning={running} taskCounts={worktree.taskCounts} />
              <div
                role="group"
                aria-label="Branch, review changes, and ship"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                {mainBranchUnavailable ? (
                  <Btn
                    variant="ghost"
                    icon="git-branch"
                    disabled
                    title={mainBranchUnavailableTitle ?? "Git unavailable"}
                    style={{
                      fontFamily: "var(--mono)",
                      maxWidth: "min(36ch, 42vw)",
                      color: "var(--text-dim)",
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
                      No Git repo
                    </span>
                  </Btn>
                ) : (
                  <BranchTypeahead
                    projectId={projectId}
                    worktreeId={null}
                    branch={mainBranchLabel}
                    disabled={branchSwitchDisabled}
                    worktreePath={worktree.path}
                    onCreateWorktree={onCreateWorktree}
                    createWorktreeDisabled={createWorktreeDisabled}
                    createWorktreeTitle={createWorktreeTitle}
                  />
                )}
                {shipControls()}
              </div>
            </div>
          ) : (
          <div
            key={worktree.id}
            role="none"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: selected ? 2 : 0,
              height: 28,
              flexShrink: 0,
            }}
          >
            <div
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
            <WorktreeBadgeDots launchRunning={running} taskCounts={worktree.taskCounts} />
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
            {selected && !worktree.isMain && !optimistic && (
              <div
                role="group"
                aria-label="Review changes and ship"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                {shipControls()}
              </div>
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
        icon="file"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
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

function WorktreeChangeStat({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface-0)",
        padding: "9px 10px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 16,
          fontWeight: 650,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </div>
    </div>
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
