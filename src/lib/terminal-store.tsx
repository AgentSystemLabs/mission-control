import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getElectron } from "./electron";
import { AGENT_REGISTRY } from "~/shared/agents";
import {
  agentLaunchMode,
  agentUsesPersistedSession,
  buildAgentLaunchCommand,
  newSessionId,
} from "./agent-command";
import { api } from "./api";
import type { TaskAgent } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";
import { worktreeScopeKey } from "~/shared/worktrees";

type ScopedProject = Project & { activeWorktreeId?: string | null };

export type OpenTerminal = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  dangerouslySkipPermissions: boolean;
  cwd: string;
  project: ScopedProject;
  task: Task;
};

type Ctx = {
  /** All live sessions (PTYs alive in background). */
  sessions: OpenTerminal[];
  /** The session currently displayed in the panel for `projectId`, if any. */
  activeFor: (projectId: string) => OpenTerminal | null;
  /** The active taskId persisted for `projectId` (null = explicitly closed). */
  activeTaskIdFor: (projectId: string) => string | null;
  /** Click a card: select if not active, deselect (hide panel) if already active. */
  toggle: (project: ScopedProject, task: Task) => void;
  /** Deselect the active card for `projectId` and hide the panel without killing the PTY. */
  deselect: (projectId: string) => void;
  /** Materialize a session entry from a persisted taskId after reload, if not already present. */
  rehydrate: (project: ScopedProject, task: Task) => void;
  /** Permanently close one session and kill its PTY. */
  close: (taskId: string) => Promise<void>;
  /** Permanently close every session for a project (kills PTYs). */
  closeForProject: (projectId: string) => Promise<void>;
  setPtyId: (taskId: string, ptyId: string | null) => void;
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
  if (!agentUsesPersistedSession(task.agent)) {
    return AGENT_REGISTRY[task.agent].startCommand({
      skipPermissions: task.claudeSkipPermissions,
    });
  }

  let sessionId = task.claudeSessionId;
  if (!sessionId && task.agent !== "codex") {
    sessionId = newSessionId();
    void api.updateTask(task.id, { claudeSessionId: sessionId }).catch(() => undefined);
  }

  const mode = agentLaunchMode({ ...task, claudeSessionId: sessionId });
  if (task.agent === "codex" && mode === "new") {
    return buildAgentLaunchCommand(task, sessionId ?? "", mode);
  }

  if (!sessionId) {
    return buildAgentLaunchCommand(task, "", mode);
  }

  return buildAgentLaunchCommand(task, sessionId, mode);
}

const ACTIVE_BY_PROJECT_KEY = "mc.terminalActiveByProject";

function scopeKeyForProject(project: ScopedProject): string {
  return worktreeScopeKey(project.id, project.activeWorktreeId);
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

function loadActiveByProject(): Record<string, string | null> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_BY_PROJECT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<OpenTerminal[]>([]);
  const [activeByProject, setActiveByProject] = useState<Record<string, string | null>>(
    loadActiveByProject
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ACTIVE_BY_PROJECT_KEY, JSON.stringify(activeByProject));
    } catch {
      /* quota or disabled */
    }
  }, [activeByProject]);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (electron) await electron.pty.kill(id).catch(() => undefined);
    else await api.killRemotePty(id).catch(() => undefined);
  };

  const toggle = useCallback(
    (project: ScopedProject, task: Task) => {
      const scopeKey = scopeKeyForProject(project);
      const hadSession = sessions.some(
        (p) => p.taskId === task.id && scopeKeyForProject(p.project) === scopeKey
      );
      setSessions((prev) => {
        if (prev.some((p) => p.taskId === task.id)) return prev;
        const next: OpenTerminal = {
          taskId: task.id,
          ptyId: null,
          startCommand: commandForTask(task),
          dangerouslySkipPermissions: !!task.claudeSkipPermissions,
          cwd: project.path,
          project,
          task,
        };
        return [...prev, next];
      });
      setActiveByProject((prev) => {
        const curr = prev[scopeKey] ?? null;
        return { ...prev, [scopeKey]: nextActiveTaskId(curr, task.id, hadSession) };
      });
    },
    [sessions]
  );

  const rehydrate = useCallback((project: ScopedProject, task: Task) => {
    setSessions((prev) => {
      if (prev.some((p) => p.taskId === task.id)) return prev;
      return [
        ...prev,
        {
          taskId: task.id,
          ptyId: null,
          startCommand: commandForTask(task),
          dangerouslySkipPermissions: !!task.claudeSkipPermissions,
          cwd: project.path,
          project,
          task,
        },
      ];
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

  const close = useCallback(async (taskId: string) => {
    setSessions((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
    });
    setActiveByProject((prev) => {
      const next: Record<string, string | null> = {};
      let changed = false;
      for (const [pid, tid] of Object.entries(prev)) {
        if (tid === taskId) {
          next[pid] = null;
          changed = true;
        } else {
          next[pid] = tid;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const closeForProject = useCallback(async (projectId: string) => {
    setSessions((prev) => {
      const remaining: OpenTerminal[] = [];
      for (const t of prev) {
        if (t.project.id === projectId) void killPty(t.ptyId);
        else remaining.push(t);
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
  }, []);

  const setPtyId = useCallback((taskId: string, ptyId: string | null) => {
    setSessions((prev) => prev.map((p) => (p.taskId === taskId ? { ...p, ptyId } : p)));
  }, []);

  const syncTask = useCallback((task: Task) => {
    setSessions((prev) =>
      prev.map((p) => (p.taskId === task.id ? { ...p, task } : p))
    );
  }, []);

  const runIn = useCallback(
    async (taskId: string, command: string) => {
      const electron = getElectron();
      const target = sessions.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      if (electron) await electron.pty.write(target.ptyId, command + "\r");
      else await api.writeRemotePty(target.ptyId, command + "\r").catch(() => undefined);
    },
    [sessions]
  );

  const activeFor = useCallback(
    (projectId: string): OpenTerminal | null => {
      const direct = activeByProject[projectId] ?? null;
      if (direct) {
        return sessions.find((s) => s.taskId === direct && scopeKeyForProject(s.project) === projectId) ?? null;
      }
      for (const [key, tid] of Object.entries(activeByProject)) {
        if (!tid || !key.startsWith(`${projectId}:`)) continue;
        const active = sessions.find((s) => s.taskId === tid && scopeKeyForProject(s.project) === key);
        if (active) return active;
      }
      return null;
    },
    [activeByProject, sessions]
  );

  const activeTaskIdFor = useCallback(
    (projectId: string) => {
      const direct = activeByProject[projectId] ?? null;
      if (direct || projectId.includes(":")) return direct;
      for (const [key, tid] of Object.entries(activeByProject)) {
        if (tid && key.startsWith(`${projectId}:`)) return tid;
      }
      return null;
    },
    [activeByProject]
  );

  const value = useMemo<Ctx>(
    () => ({
      sessions,
      activeFor,
      activeTaskIdFor,
      toggle,
      deselect,
      rehydrate,
      close,
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
      deselect,
      rehydrate,
      close,
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
