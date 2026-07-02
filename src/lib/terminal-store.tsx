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
import { api } from "./api";
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
};

const TerminalContext = createContext<Ctx | null>(null);

function commandFor(agent: TaskAgent): string {
  return AGENT_REGISTRY[agent].startCommand();
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

function terminalSurfaceIdForProject(project: ScopedProject, taskId: string): string {
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
  const [sessions, setSessions] = useState<OpenTerminal[]>([]);
  const [activeByProject, setActiveByProject] = useState<Record<string, string | null>>(
    loadActiveByProject
  );
  const [visibleScopeByProject, setVisibleScopeByProject] = useState<Record<string, string>>({});

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
      const hadSession = sessions.some(
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
    [sessions]
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

  const adoptTaskId = useCallback((fromTaskId: string, task: Task) => {
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
        if (p.task === task) return p;
        changed = true;
        return { ...p, task };
      });
      return changed ? next : prev;
    });
  }, []);

  const runIn = useCallback(
    async (taskId: string, command: string) => {
      const electron = getElectron();
      const target = sessions.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      if (electron) {
        const ptyApi = isRemotePtyId(target.ptyId) ? electron.remotePty : electron.pty;
        await ptyApi.write(target.ptyId, command + "\r");
      }
    },
    [sessions]
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

  const value = useMemo<Ctx>(
    () => ({
      sessions,
      activeFor,
      activeTaskIdFor,
      toggle,
      openSession,
      deselect,
      setVisibleScope,
      rehydrate,
      close,
      adoptTaskId,
      closeForProject,
      setPtyId,
      syncTask,
      startCommandFor: commandFor,
      runIn,
    }),
    [
      sessions,
      activeFor,
      activeTaskIdFor,
      toggle,
      openSession,
      deselect,
      setVisibleScope,
      rehydrate,
      close,
      adoptTaskId,
      closeForProject,
      setPtyId,
      syncTask,
      runIn,
    ]
  );

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useTerminals() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminals must be used inside TerminalProvider");
  return ctx;
}
