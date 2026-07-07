import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getElectron } from "./electron";
import { markIntentionalSessionClose } from "./intentional-session-close";
import { isRemotePtyId } from "./pty-id";
import { terminalSurfaceCache } from "./terminal-surface-cache";
import { AGENT_REGISTRY } from "~/shared/agents";
import {
  agentLaunchMode,
  agentUsesPersistedSession,
  buildAgentLaunchCommand,
  newSessionId,
} from "./agent-command";
import { api, ApiError } from "./api";
import type { TaskAgent } from "~/shared/domain";
import type { Task } from "~/db/schema";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { MAIN_WORKTREE_ID, worktreeScopeKey } from "~/shared/worktrees";
import { scopeKeyForProject, type ScopedProject } from "./scoped-project";
import { getDefaultModelForAgent } from "./default-model-store";

export type OpenTerminal = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  dangerouslySkipPermissions: boolean;
  cwd: string;
  project: ScopedProject;
  task: Task;
  /** PTY spawn waits until the task row exists on the server. */
  awaitingCreate?: boolean;
  /** Restored from localStorage; PTY spawn waits until the task is revalidated
   *  against the server. Dead/archived tasks are dropped instead of respawning,
   *  and live ones get a fresh snapshot + rebuilt start command. */
  pendingValidation?: boolean;
};

type Ctx = {
  /** All live sessions (PTYs alive in background). */
  sessions: OpenTerminal[];
  /** The session currently displayed in the panel for `projectId`, if any. */
  activeFor: (projectId: string) => OpenTerminal | null;
  /** The active taskId persisted for `projectId` (null = explicitly closed). */
  activeTaskIdFor: (projectId: string) => string | null;
  /** Click a card: select if not active, deselect (hide panel) if already active. */
  toggle: (project: ScopedProject, task: Task, opts?: { awaitCreate?: boolean }) => void;
  /** Select a session and optionally attach an already-running PTY (warm pool claim). */
  openSession: (
    project: ScopedProject,
    task: Task,
    opts?: { ptyId?: string | null },
  ) => void;
  /** Deselect the active card for `projectId` and hide the panel without killing the PTY. */
  deselect: (projectId: string) => void;
  /** Mark an already-open session as the active one for its scope, without
   *  materializing or mutating the session. Focus mode uses it so switching the
   *  focused tab also moves the scope's active selection — exiting then restores
   *  the default view onto the session that was on screen while floating. */
  setActiveSession: (project: ScopedProject, taskId: string) => void;
  /** Tell root-level panel lookup which worktree scope is currently visible for a project. */
  setVisibleScope: (projectId: string, scopeKey: string | null) => void;
  /** Materialize a session entry from a persisted taskId after reload, if not already present. */
  rehydrate: (project: ScopedProject, task: Task) => void;
  /** Permanently close one session and kill its PTY. */
  close: (taskId: string, opts?: { activateTaskId?: string | null }) => Promise<void>;
  /** Swap a provisional task id (optimistic create) for the persisted task. */
  adoptTaskId: (fromTaskId: string, task: Task) => void;
  /** Permanently close every session for a project (kills PTYs). */
  closeForProject: (projectId: string) => Promise<void>;
  setPtyId: (taskId: string, ptyId: string | null, scopeKey?: string) => void;
  syncTask: (task: Task) => void;
  startCommandFor: (agent: TaskAgent) => string;
  /** Run an arbitrary command in the active PTY for this task. */
  runIn: (taskId: string, command: string) => Promise<void>;
  /** Whether the full-width "all sessions" grid view is active. */
  gridView: boolean;
  setGridView: (value: boolean) => void;
  /** Flip the grid view on/off. */
  toggleGridView: () => void;
  /** Latest request to spotlight a session cell in the grid (e.g. from a
   *  notification's "Open"). The nonce makes repeated requests for the same
   *  task retrigger the grid's focus effect. */
  gridFocusRequest: { taskId: string; nonce: number } | null;
  /** Ask the grid to scroll to, highlight, and focus a session's cell. */
  focusGridSession: (taskId: string) => void;
  /** Claim a spotlight request for handling. True exactly once per nonce: the
   *  request state lingers after the grid's focus effect runs, and the grid
   *  remounts across project switches, so without this a stale request would
   *  replay on mount and un-hide the session it targeted. */
  consumeGridFocusRequest: (nonce: number) => boolean;
  /** Ask the grid to drop the next newly-created session directly after this
   *  source session (used by "Clone session" so a clone lands beside its
   *  origin instead of at the end of the grid). */
  requestCloneInsertAfter: (sourceTaskId: string) => void;
  /** Consume the pending clone-insert source id (null if none is queued). */
  takeCloneInsertAfter: () => string | null;
  /** Report the grid cell whose terminal just took focus (null on blur away). */
  noteGridFocusedTask: (taskId: string | null) => void;
  /** The grid cell that most recently held focus, or null. Lets callers anchor a
   *  new session on the active pane even after a button click moved DOM focus. */
  getGridFocusedTaskId: () => string | null;
  /** Ask the grid to place the next newly-created session in a brand-new row at
   *  the bottom (used by the grid's "New row" button). */
  requestNewRow: () => void;
  /** Consume the pending new-row request (true if one is queued). */
  takeNewRowRequest: () => boolean;
  /** Consume any provisional→persisted session id renames since the last call,
   *  so views keyed by taskId can preserve position across adoption. */
  takeSessionIdRenames: () => Array<{ from: string; to: string }>;
};

// The store is split into two contexts so a session-status tick (which churns
// `sessions`) only re-renders consumers that actually read reactive data. The
// data slice changes on session/active/gridView updates; the actions slice
// keeps a constant identity for the provider's lifetime, so pure-action
// consumers (e.g. every TerminalPane, which only needs syncTask) never
// re-render when a background session updates.
type TerminalDataKeys =
  | "sessions"
  | "activeFor"
  | "activeTaskIdFor"
  | "gridView"
  | "gridFocusRequest";
type TerminalData = Pick<Ctx, TerminalDataKeys>;
type TerminalActions = Omit<Ctx, TerminalDataKeys>;

const TerminalActionsContext = createContext<TerminalActions | null>(null);
const TerminalDataContext = createContext<TerminalData | null>(null);

function commandFor(agent: TaskAgent): string {
  return AGENT_REGISTRY[agent].startCommand();
}

/** Shallow field equality for two task rows. Task is a flat DB row of
 *  primitives, so comparing own-enumerable keys is both correct and robust to
 *  schema growth — used to skip `sessions` churn on no-op refetches. */
function tasksEqual(a: Task, b: Task): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof Task)[];
  const bKeys = Object.keys(b) as (keyof Task)[];
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Compute the start command for a task. Hook-capable agents embed either a
 * new-session or resume invocation so conversations survive app restarts.
 * Side effect: generates and persists a session ID when one is missing on
 * agents that require a preassigned id (defensive — task creation should
 * have populated it).
 */
export function commandForTask(task: Task): string {
  return baseCommandForTask(task, getDefaultModelForAgent(task.agent));
}

function baseCommandForTask(task: Task, model: string | null): string {
  if (!agentUsesPersistedSession(task.agent)) {
    return AGENT_REGISTRY[task.agent].startCommand({
      skipPermissions: task.claudeSkipPermissions,
    });
  }

  let sessionId = task.claudeSessionId;
  if (!sessionId && task.agent !== "codex" && task.agent !== "opencode") {
    sessionId = newSessionId();
    void api.updateTask(task.id, { claudeSessionId: sessionId }).catch(() => undefined);
  }

  const mode = agentLaunchMode({ ...task, claudeSessionId: sessionId });
  if ((task.agent === "codex" || task.agent === "opencode") && mode === "new") {
    return buildAgentLaunchCommand(task, sessionId ?? "", mode, { model });
  }

  if (!sessionId) {
    return buildAgentLaunchCommand(task, "", mode, { model });
  }

  return buildAgentLaunchCommand(task, sessionId, mode, { model });
}

const ACTIVE_BY_PROJECT_KEY = "mc.terminalActiveByProject";
const REMOTE_PTY_BY_TASK_KEY = "mc.remotePtyByTask";
const GRID_VIEW_KEY = "mc.gridView";
const OPEN_SESSIONS_KEY = "mc.terminalOpenSessions";
/** Sessions change on hot paths (task sync per server event, per-pane ptyId
 *  updates while a grid boots), so open-session persistence is debounced. */
const SESSION_PERSIST_DEBOUNCE_MS = 300;

function loadGridView(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GRID_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

/** Cache id of a session's xterm surface (shared by TerminalPane's build,
 *  the store's teardown paths, and the grid's progressive mount). */
export function terminalSurfaceIdForProject(
  project: { activeWorktreeId?: string | null; activeRuntimeScopeId?: string | null },
  taskId: string,
): string {
  return `${taskId}:${project.activeWorktreeId ?? MAIN_WORKTREE_ID}:${project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID}`;
}

function loadRemotePtyByTask(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REMOTE_PTY_BY_TASK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [taskId, ptyId] of Object.entries(parsed)) {
      if (typeof ptyId === "string" && isRemotePtyId(ptyId)) out[taskId] = ptyId;
    }
    return out;
  } catch {
    return {};
  }
}

function saveRemotePtyByTask(next: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMOTE_PTY_BY_TASK_KEY, JSON.stringify(next));
  } catch {
    /* quota or disabled */
  }
}

export function remotePtyIdForTask(taskId: string): string | null {
  const ptyId = loadRemotePtyByTask()[taskId];
  return isRemotePtyId(ptyId) ? ptyId : null;
}

function remotePtyStorageKey(scopeKey: string, taskId: string): string {
  return `${scopeKey}#${taskId}`;
}

function remotePtyIdForSession(project: ScopedProject, taskId: string): string | null {
  const current = loadRemotePtyByTask();
  const scoped = current[remotePtyStorageKey(scopeKeyForProject(project), taskId)];
  if (isRemotePtyId(scoped)) return scoped;
  return remotePtyIdForTask(taskId);
}

function rememberRemotePtyForTask(storageKey: string, ptyId: string | null): void {
  const current = loadRemotePtyByTask();
  if (ptyId && isRemotePtyId(ptyId)) current[storageKey] = ptyId;
  else delete current[storageKey];
  saveRemotePtyByTask(current);
}

function adoptRemotePtyTaskId(fromTaskId: string, toTaskId: string): void {
  const current = loadRemotePtyByTask();
  let changed = false;
  for (const [key, ptyId] of Object.entries(current)) {
    if (!isRemotePtyId(ptyId)) continue;
    if (key === fromTaskId) {
      delete current[key];
      current[toTaskId] = ptyId;
      changed = true;
      continue;
    }
    if (key.endsWith(`#${fromTaskId}`)) {
      delete current[key];
      current[`${key.slice(0, -fromTaskId.length)}${toTaskId}`] = ptyId;
      changed = true;
    }
  }
  if (changed) saveRemotePtyByTask(current);
}

export function nextActiveTaskId(
  currentTaskId: string | null,
  requestedTaskId: string,
  hasMaterializedSession: boolean
): string | null {
  return currentTaskId === requestedTaskId && hasMaterializedSession
    ? null
    : requestedTaskId;
}

/** Grace period before an un-selected archived session's PTY is reaped. */
export const ARCHIVED_SESSION_REAP_DELAY_MS = 60_000;

/**
 * Opened archived sessions whose PTY is eligible to be reaped right now.
 *
 * Clicking an archived card resumes its PTY so the user can inspect history,
 * but a left-open archived terminal leaks memory. A session qualifies once it
 * is archived AND is no longer the active selection in its scope (the user
 * closed it or switched to another card). An archived session that is still
 * selected is kept alive — reaping is deferred until they switch away.
 */
export function archivedSessionsEligibleForReap(
  sessions: OpenTerminal[],
  activeByProject: Record<string, string | null>,
): string[] {
  const eligible: string[] = [];
  for (const session of sessions) {
    if (!session.task.archived) continue;
    const scopeKey = scopeKeyForProject(session.project);
    if ((activeByProject[scopeKey] ?? null) === session.taskId) continue;
    eligible.push(session.taskId);
  }
  return eligible;
}

function loadActiveByProject(): Record<string, string | null> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_BY_PROJECT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

/** Fields persisted per open session so the whole set (not just the active
 *  one) can be restored after a reload — required for the grid view, which
 *  renders every open session at once. */
type PersistedSession = Pick<
  OpenTerminal,
  "taskId" | "startCommand" | "dangerouslySkipPermissions" | "cwd" | "project" | "task"
>;

function serializeSessions(sessions: OpenTerminal[]): PersistedSession[] {
  return sessions
    // Skip provisional (optimistic-create) sessions whose task row isn't saved
    // yet, and archived sessions (they get reaped, so don't resurrect them).
    .filter((s) => !s.awaitingCreate && !s.task.archived)
    .map((s) => ({
      taskId: s.taskId,
      startCommand: s.startCommand,
      dangerouslySkipPermissions: s.dangerouslySkipPermissions,
      cwd: s.cwd,
      project: s.project,
      task: s.task,
    }));
}

function loadPersistedSessions(): OpenTerminal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OPEN_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const restored: OpenTerminal[] = [];
    for (const entry of parsed as PersistedSession[]) {
      if (!entry || typeof entry.taskId !== "string" || !entry.project || !entry.task) continue;
      // Dedupe by task id alone (not scope key): a task belongs to exactly one
      // worktree, so the same id under two scope keys is the same underlying
      // agent session. Restoring both would resume one pinned session id twice
      // and the second spawn dies with "session ID is already in use".
      if (seen.has(entry.taskId)) continue;
      seen.add(entry.taskId);
      restored.push({
        taskId: entry.taskId,
        // Reconnect to a still-alive remote PTY if we have one; local PTYs are
        // re-spawned lazily when the pane mounts.
        ptyId: remotePtyIdForSession(entry.project, entry.taskId),
        startCommand: entry.startCommand,
        dangerouslySkipPermissions: entry.dangerouslySkipPermissions,
        cwd: entry.cwd,
        project: entry.project,
        task: entry.task,
        // Gate the pane's PTY spawn until the snapshot is revalidated against
        // the server (see the validation effect in TerminalProvider).
        pendingValidation: true,
      });
    }
    return restored;
  } catch {
    return [];
  }
}

export function resolveActiveTaskIdForProject(
  activeByProject: Record<string, string | null>,
  projectId: string,
  visibleScopeByProject: Record<string, string | null> = {},
): { scopeKey: string | null; taskId: string | null } {
  if (projectId.includes(":")) {
    return { scopeKey: projectId, taskId: activeByProject[projectId] ?? null };
  }

  const visibleScopeKey = visibleScopeByProject[projectId] ?? null;
  if (visibleScopeKey) {
    return { scopeKey: visibleScopeKey, taskId: activeByProject[visibleScopeKey] ?? null };
  }

  const mainScopeKey = worktreeScopeKey(projectId, null);
  const mainTaskId = activeByProject[mainScopeKey] ?? activeByProject[projectId] ?? null;
  if (mainTaskId) return { scopeKey: mainScopeKey, taskId: mainTaskId };

  for (const [key, taskId] of Object.entries(activeByProject)) {
    if (taskId && key.startsWith(`${projectId}:`)) {
      return { scopeKey: key, taskId };
    }
  }

  return { scopeKey: null, taskId: null };
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<OpenTerminal[]>(loadPersistedSessions);
  const [activeByProject, setActiveByProject] = useState<Record<string, string | null>>(
    loadActiveByProject
  );
  const [visibleScopeByProject, setVisibleScopeByProject] = useState<Record<string, string>>({});
  const [gridView, setGridViewState] = useState<boolean>(loadGridView);
  // Read via a ref so `toggleGridView` keeps a stable identity (it lives in the
  // stable actions context) instead of re-creating on every gridView flip.
  const gridViewRef = useRef(gridView);
  gridViewRef.current = gridView;

  const setGridView = useCallback((value: boolean) => {
    setGridViewState(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(GRID_VIEW_KEY, value ? "1" : "0");
    } catch {
      /* quota or disabled */
    }
  }, []);

  const toggleGridView = useCallback(() => {
    setGridView(!gridViewRef.current);
  }, [setGridView]);

  const [gridFocusRequest, setGridFocusRequest] = useState<
    { taskId: string; nonce: number } | null
  >(null);
  const gridFocusNonceRef = useRef(0);
  const focusGridSession = useCallback((taskId: string) => {
    gridFocusNonceRef.current += 1;
    setGridFocusRequest({ taskId, nonce: gridFocusNonceRef.current });
  }, []);
  // Highest nonce the grid has handled. Kept here (not in the grid) so it
  // survives the grid unmounting/remounting across project switches — a ref,
  // not state, so consuming never re-renders (and never cancels the grid's
  // in-flight focus polling).
  const gridFocusConsumedNonceRef = useRef(0);
  const consumeGridFocusRequest = useCallback((nonce: number) => {
    if (nonce <= gridFocusConsumedNonceRef.current) return false;
    gridFocusConsumedNonceRef.current = nonce;
    return true;
  }, []);

  // Source session id for a pending clone: the grid drops the next new session
  // right after it. Refs (not state) so requesting doesn't re-render, and the
  // grid consumes the value exactly once as it reconciles its order.
  const cloneInsertAfterRef = useRef<string | null>(null);
  const requestCloneInsertAfter = useCallback((sourceTaskId: string) => {
    cloneInsertAfterRef.current = sourceTaskId;
  }, []);
  const takeCloneInsertAfter = useCallback(() => {
    const source = cloneInsertAfterRef.current;
    cloneInsertAfterRef.current = null;
    return source;
  }, []);
  // The grid cell whose terminal most recently held focus — the pane the user is
  // "on". The grid reports it on focusin; the project route reads it to anchor a
  // new session beside the active pane even when the click that created it (e.g.
  // the header "New session" button) pulled DOM focus off the grid. A ref so
  // reporting focus never re-renders the whole terminal tree.
  const gridFocusedTaskIdRef = useRef<string | null>(null);
  const noteGridFocusedTask = useCallback((taskId: string | null) => {
    gridFocusedTaskIdRef.current = taskId;
    if (!taskId) return;
    // Keep the scope's active session in step with the grid's focused cell, so
    // leaving the grid lands on the pane the user was on rather than whatever
    // was active before. The functional update returns `prev` unchanged when it
    // already matches, so this only re-renders on a real cell-to-cell focus
    // change (typing in one cell never touches it). sessionsRef is read at call
    // time — always populated by the time a focusin fires.
    const session = sessionsRef.current.find((s) => s.taskId === taskId);
    if (!session) return;
    const scopeKey = scopeKeyForProject(session.project);
    setActiveByProject((prev) =>
      prev[scopeKey] === taskId ? prev : { ...prev, [scopeKey]: taskId },
    );
  }, []);
  const getGridFocusedTaskId = useCallback(() => gridFocusedTaskIdRef.current, []);
  // Pending "New row" request: the grid drops the next new session into a fresh
  // bottom row. Ref (not state) so requesting doesn't re-render, consumed once.
  const newRowRequestRef = useRef(false);
  const requestNewRow = useCallback(() => {
    newRowRequestRef.current = true;
  }, []);
  const takeNewRowRequest = useCallback(() => {
    const pending = newRowRequestRef.current;
    newRowRequestRef.current = false;
    return pending;
  }, []);
  const sessionIdRenamesRef = useRef<Array<{ from: string; to: string }>>([]);
  const takeSessionIdRenames = useCallback(() => {
    if (sessionIdRenamesRef.current.length === 0) return [];
    const renames = sessionIdRenamesRef.current;
    sessionIdRenamesRef.current = [];
    return renames;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ACTIVE_BY_PROJECT_KEY, JSON.stringify(activeByProject));
    } catch {
      /* quota or disabled */
    }
  }, [activeByProject]);

  useEffect(() => {
    for (const session of sessions) {
      if (isRemotePtyId(session.ptyId)) {
        rememberRemotePtyForTask(
          remotePtyStorageKey(scopeKeyForProject(session.project), session.taskId),
          session.ptyId,
        );
      }
    }
  }, [sessions]);

  // Persist the full open-session set so a reload can restore every session
  // (the grid renders all of them), not just the active one per scope. Each
  // entry embeds its project + task, so serializing on every sessions change
  // would put a large synchronous stringify + write on hot paths — debounce
  // it, skip writes whose payload is unchanged, and flush on pagehide (and
  // provider teardown) so a quit never loses the latest set.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedRef = useRef<string | null>(null);
  const flushPersistedSessions = useCallback(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const payload = JSON.stringify(serializeSessions(sessionsRef.current));
    if (payload === lastPersistedRef.current) return;
    lastPersistedRef.current = payload;
    try {
      window.localStorage.setItem(OPEN_SESSIONS_KEY, payload);
    } catch {
      /* quota or disabled */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(flushPersistedSessions, SESSION_PERSIST_DEBOUNCE_MS);
  }, [sessions, flushPersistedSessions]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", flushPersistedSessions);
    return () => {
      window.removeEventListener("pagehide", flushPersistedSessions);
      flushPersistedSessions();
    };
  }, [flushPersistedSessions]);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (electron) {
      const ptyApi = isRemotePtyId(id) ? electron.remotePty : electron.pty;
      await ptyApi.kill(id).catch(() => undefined);
    }
  };

  const toggle = useCallback(
    (project: ScopedProject, task: Task, opts?: { awaitCreate?: boolean }) => {
      const scopeKey = scopeKeyForProject(project);
      const hadSession = sessionsRef.current.some(
        (p) => p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey
      );
      setSessions((prev) => {
        const existing = prev.find(
          (p) => p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey
        );
        if (existing) {
          if (!opts?.awaitCreate || existing.awaitingCreate) return prev;
          return prev.map((p) =>
            p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey
              ? { ...p, awaitingCreate: true, task }
              : p
          );
        }
        const next: OpenTerminal = {
          taskId: task.id,
          ptyId: remotePtyIdForSession(project, task.id),
          startCommand: commandForTask(task),
          dangerouslySkipPermissions: !!task.claudeSkipPermissions,
          cwd: project.path,
          project,
          task,
          awaitingCreate: opts?.awaitCreate,
        };
        return [...prev, next];
      });
      setActiveByProject((prev) => {
        const curr = prev[scopeKey] ?? null;
        const next = nextActiveTaskId(curr, task.id, hadSession);
        return curr === next ? prev : { ...prev, [scopeKey]: next };
      });
    },
    []
  );

  const openSession = useCallback(
    (project: ScopedProject, task: Task, opts?: { ptyId?: string | null }) => {
      const scopeKey = scopeKeyForProject(project);
      setSessions((prev) => {
        const existing = prev.find(
          (p) => p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey
        );
        if (existing) {
          return prev.map((p) =>
            p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey
              ? {
                  ...p,
                  task,
                  ptyId: opts?.ptyId ?? p.ptyId ?? remotePtyIdForSession(project, task.id),
                  startCommand: commandForTask(task),
                  dangerouslySkipPermissions: !!task.claudeSkipPermissions,
                  awaitingCreate: false,
                  // The caller holds a live task row — no revalidation needed.
                  pendingValidation: undefined,
                }
              : p
          );
        }
        return [
          ...prev,
          {
            taskId: task.id,
            ptyId: opts?.ptyId ?? remotePtyIdForSession(project, task.id),
            startCommand: commandForTask(task),
            dangerouslySkipPermissions: !!task.claudeSkipPermissions,
            cwd: project.path,
            project,
            task,
          },
        ];
      });
      setActiveByProject((prev) =>
        prev[scopeKey] === task.id ? prev : { ...prev, [scopeKey]: task.id }
      );
    },
    []
  );

  const rehydrate = useCallback((project: ScopedProject, task: Task) => {
    const scopeKey = scopeKeyForProject(project);
    setSessions((prev) => {
      if (prev.some((p) => p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey)) {
        return prev;
      }
      return [
        ...prev,
        {
          taskId: task.id,
          ptyId: remotePtyIdForSession(project, task.id),
          startCommand: commandForTask(task),
          dangerouslySkipPermissions: !!task.claudeSkipPermissions,
          cwd: project.path,
          project,
          task,
        },
      ];
    });
  }, []);

  const setVisibleScope = useCallback((projectId: string, scopeKey: string | null) => {
    setVisibleScopeByProject((prev) => {
      if (scopeKey === null) {
        if (!(projectId in prev)) return prev;
        const next = { ...prev };
        delete next[projectId];
        return next;
      }
      return prev[projectId] === scopeKey ? prev : { ...prev, [projectId]: scopeKey };
    });
  }, []);

  const deselect = useCallback((projectId: string) => {
    setActiveByProject((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (key === projectId || key.startsWith(`${projectId}:`)) {
          next[key] = null;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const setActiveSession = useCallback((project: ScopedProject, taskId: string) => {
    const scopeKey = scopeKeyForProject(project);
    setActiveByProject((prev) =>
      prev[scopeKey] === taskId ? prev : { ...prev, [scopeKey]: taskId }
    );
  }, []);

  const adoptTaskId = useCallback((fromTaskId: string, task: Task) => {
    // Record the id swap so views keyed by taskId (e.g. the grid order) can
    // follow the session in place instead of treating it as a fresh add.
    if (fromTaskId !== task.id) {
      sessionIdRenamesRef.current.push({ from: fromTaskId, to: task.id });
    }
    adoptRemotePtyTaskId(fromTaskId, task.id);
    // The pane re-keys to the persisted id and remounts under it; dispose the
    // provisional-id surface so it doesn't leak (the new pane re-attaches to the
    // same PTY via replay).
    terminalSurfaceCache.destroy(fromTaskId);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.taskId !== fromTaskId) return p;
        changed = true;
        return {
          ...p,
          taskId: task.id,
          task,
          startCommand: commandForTask(task),
          dangerouslySkipPermissions: !!task.claudeSkipPermissions,
          awaitingCreate: false,
        };
      });
      return changed ? next : prev;
    });
    setActiveByProject((prev) => {
      let changed = false;
      const next: Record<string, string | null> = { ...prev };
      for (const [key, tid] of Object.entries(prev)) {
        if (tid === fromTaskId) {
          next[key] = task.id;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const close = useCallback(async (taskId: string, opts?: { activateTaskId?: string | null }) => {
    markIntentionalSessionClose(taskId);
    setSessions((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) {
        terminalSurfaceCache.destroy(terminalSurfaceIdForProject(target.project, target.taskId));
        rememberRemotePtyForTask(
          remotePtyStorageKey(scopeKeyForProject(target.project), target.taskId),
          null,
        );
        void killPty(target.ptyId);
      }
      return prev.filter((p) => p.taskId !== taskId);
    });
    setActiveByProject((prev) => {
      const next: Record<string, string | null> = {};
      let changed = false;
      for (const [pid, tid] of Object.entries(prev)) {
        if (tid === taskId) {
          next[pid] =
            opts?.activateTaskId !== undefined ? (opts.activateTaskId ?? null) : null;
          changed = true;
        } else {
          next[pid] = tid;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Reap opened archived sessions. Clicking an archived card resumes its PTY
  // so its history can be inspected; once the user closes it or switches to
  // another card, kill the PTY after a grace period to reclaim memory.
  // Re-selecting the session before the timer fires cancels the kill (it drops
  // out of the eligible set); switching away again reschedules it. Reaping only
  // ever targets non-active sessions, so it never disturbs the visible panel.
  const reapTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = reapTimersRef.current;
    const eligible = new Set(archivedSessionsEligibleForReap(sessions, activeByProject));
    for (const taskId of eligible) {
      if (timers.has(taskId)) continue;
      timers.set(
        taskId,
        setTimeout(() => {
          timers.delete(taskId);
          void close(taskId);
        }, ARCHIVED_SESSION_REAP_DELAY_MS),
      );
    }
    for (const [taskId, timer] of timers) {
      if (eligible.has(taskId)) continue;
      clearTimeout(timer);
      timers.delete(taskId);
    }
  }, [sessions, activeByProject, close]);

  useEffect(() => {
    const timers = reapTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Revalidate restored sessions against the server once on startup. Sessions
  // are seeded straight from the localStorage snapshot, which can be stale: a
  // task archived or deleted while this window was closed (server cleanup, a
  // second window) must not resurrect as a live cell — or worse, respawn its
  // agent — and a live task's launch command may have changed since the
  // snapshot (agent/model/skip-permissions), so it is rebuilt from the fresh
  // row. Panes hold off spawning until their session's gate clears
  // (pendingValidation), so a dead task's agent never boots.
  const validationRanRef = useRef(false);
  useEffect(() => {
    if (validationRanRef.current) return;
    validationRanRef.current = true;
    const pending = sessions.filter((s) => s.pendingValidation);
    if (pending.length === 0) return;
    void (async () => {
      const checks = await Promise.all(
        pending.map(async (session) => {
          try {
            const { task } = await api.getTask(session.taskId);
            return { taskId: session.taskId, task: task as Task | null };
          } catch (err) {
            // 404 → the task is gone; drop the session. Any other failure
            // (server briefly unreachable) → release the gate and run on the
            // snapshot rather than leaving the pane blocked forever.
            const gone = err instanceof ApiError && err.status === 404;
            return { taskId: session.taskId, task: gone ? null : undefined };
          }
        }),
      );
      // Rebuild launch commands outside the state updater — commandForTask can
      // persist a missing session id, and updaters must stay side-effect free.
      const refreshed = new Map(
        checks
          .filter((c): c is { taskId: string; task: Task } => !!c.task && !c.task.archived)
          .map((c) => [c.taskId, { task: c.task, startCommand: commandForTask(c.task) }]),
      );
      for (const c of checks) {
        if (c.task === null || c.task?.archived) void close(c.taskId);
      }
      setSessions((prev) =>
        prev.map((p) => {
          if (!p.pendingValidation) return p;
          const fresh = refreshed.get(p.taskId);
          if (!fresh) {
            // Validation errored (non-404): release the gate, keep the snapshot.
            return { ...p, pendingValidation: undefined };
          }
          return {
            ...p,
            task: fresh.task,
            startCommand: fresh.startCommand,
            dangerouslySkipPermissions: !!fresh.task.claudeSkipPermissions,
            pendingValidation: undefined,
          };
        }),
      );
    })();
  }, [sessions, close]);

  const closeForProject = useCallback(async (projectId: string) => {
    setSessions((prev) => {
      const remaining: OpenTerminal[] = [];
      for (const t of prev) {
        if (t.project.id === projectId) {
          markIntentionalSessionClose(t.taskId);
          rememberRemotePtyForTask(
            remotePtyStorageKey(scopeKeyForProject(t.project), t.taskId),
            null,
          );
          terminalSurfaceCache.destroy(terminalSurfaceIdForProject(t.project, t.taskId));
          void killPty(t.ptyId);
        } else remaining.push(t);
      }
      return remaining;
    });
    setActiveByProject((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (key === projectId || key.startsWith(`${projectId}:`)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setVisibleScopeByProject((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  const setPtyId = useCallback((taskId: string, ptyId: string | null, scopeKey?: string) => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.taskId !== taskId) return p;
        const sessionScopeKey = scopeKeyForProject(p.project);
        if (scopeKey && sessionScopeKey !== scopeKey) return p;
        rememberRemotePtyForTask(remotePtyStorageKey(sessionScopeKey, taskId), ptyId);
        if (p.ptyId === ptyId) return p;
        changed = true;
        return { ...p, ptyId };
      });
      return changed ? next : prev;
    });
  }, []);

  const syncTask = useCallback((task: Task) => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.taskId !== task.id) return p;
        // Tasks come off the query cache as freshly-parsed rows (new refs) on
        // every refetch, so a reference check alone treats every SSE-driven
        // refetch as a change and churns `sessions` (re-rendering every
        // useTerminals() consumer) even when the row is byte-identical. Compare
        // by field so an unchanged refetch is a genuine no-op.
        if (tasksEqual(p.task, task)) return p;
        changed = true;
        return { ...p, task };
      });
      return changed ? next : prev;
    });
  }, []);

  const runIn = useCallback(
    async (taskId: string, command: string) => {
      const electron = getElectron();
      const target = sessionsRef.current.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      if (electron) {
        const ptyApi = isRemotePtyId(target.ptyId) ? electron.remotePty : electron.pty;
        await ptyApi.write(target.ptyId, command + "\r");
      }
    },
    []
  );

  const activeFor = useCallback(
    (projectId: string): OpenTerminal | null => {
      const { scopeKey, taskId } = resolveActiveTaskIdForProject(
        activeByProject,
        projectId,
        visibleScopeByProject,
      );
      if (!scopeKey || !taskId) return null;
      return (
        sessions.find((s) => s.taskId === taskId && scopeKeyForProject(s.project) === scopeKey) ??
        null
      );
    },
    [activeByProject, sessions, visibleScopeByProject]
  );

  const activeTaskIdFor = useCallback(
    (projectId: string) => {
      return resolveActiveTaskIdForProject(
        activeByProject,
        projectId,
        visibleScopeByProject,
      ).taskId;
    },
    [activeByProject, visibleScopeByProject]
  );

  // Stable slice: every dependency is a constant-identity callback, so this memo
  // computes once and the actions context never changes — pure-action consumers
  // (useTerminalActions) don't re-render when `sessions` churns.
  const actions = useMemo<TerminalActions>(
    () => ({
      toggle,
      openSession,
      deselect,
      setActiveSession,
      setVisibleScope,
      rehydrate,
      close,
      adoptTaskId,
      closeForProject,
      setPtyId,
      syncTask,
      startCommandFor: commandFor,
      runIn,
      setGridView,
      toggleGridView,
      focusGridSession,
      consumeGridFocusRequest,
      requestCloneInsertAfter,
      takeCloneInsertAfter,
      noteGridFocusedTask,
      getGridFocusedTaskId,
      requestNewRow,
      takeNewRowRequest,
      takeSessionIdRenames,
    }),
    [
      toggle,
      openSession,
      deselect,
      setActiveSession,
      setVisibleScope,
      rehydrate,
      close,
      adoptTaskId,
      closeForProject,
      setPtyId,
      syncTask,
      runIn,
      setGridView,
      toggleGridView,
      focusGridSession,
      consumeGridFocusRequest,
      requestCloneInsertAfter,
      takeCloneInsertAfter,
      noteGridFocusedTask,
      getGridFocusedTaskId,
      requestNewRow,
      takeNewRowRequest,
      takeSessionIdRenames,
    ]
  );

  // Reactive slice: changes when sessions / active selection / grid state move.
  const data = useMemo<TerminalData>(
    () => ({
      sessions,
      activeFor,
      activeTaskIdFor,
      gridView,
      gridFocusRequest,
    }),
    [sessions, activeFor, activeTaskIdFor, gridView, gridFocusRequest]
  );

  return (
    <TerminalActionsContext.Provider value={actions}>
      <TerminalDataContext.Provider value={data}>{children}</TerminalDataContext.Provider>
    </TerminalActionsContext.Provider>
  );
}

/** Full store (actions + reactive data). Re-renders on any data change; prefer
 *  `useTerminalActions` when you only need to call methods. The merged object
 *  keeps a stable identity until actions or data actually change, so consumers
 *  that list `terminals` in a dependency array don't churn on every render. */
export function useTerminals(): Ctx {
  const actions = useContext(TerminalActionsContext);
  const data = useContext(TerminalDataContext);
  const merged = useMemo(
    () => (actions && data ? { ...actions, ...data } : null),
    [actions, data],
  );
  if (!merged) throw new Error("useTerminals must be used inside TerminalProvider");
  return merged;
}

/** Stable actions only. A component using this never re-renders when sessions
 *  or the active selection change — use it for pure command consumers. */
export function useTerminalActions(): TerminalActions {
  const actions = useContext(TerminalActionsContext);
  if (!actions) throw new Error("useTerminalActions must be used inside TerminalProvider");
  return actions;
}
