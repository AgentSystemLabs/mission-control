import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { STORAGE_KEYS } from "./storage-keys";
import { AGENT_REGISTRY } from "~/shared/agents";
import { buildClaudeCommand, newSessionId } from "./claude-command";
import { api } from "./api";
import { getRuntime } from "./runtime";
import { useServerEvents } from "./use-events";
import {
  killPty,
  nullifyMatchingValues,
  removeKey,
  useLocalStorageRecord,
} from "./pty-store-internals";
import type { TaskAgent } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";

export type OpenTerminal = {
  taskId: string;
  ptyId: string | null;
  startCommand: string;
  cwd: string;
  project: Project;
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
  toggle: (project: Project, task: Task) => void;
  /** Deselect the active card for `projectId` and hide the panel without killing the PTY. */
  deselect: (projectId: string) => void;
  /** Materialize a session entry from a persisted taskId after reload, if not already present. */
  rehydrate: (project: Project, task: Task) => void;
  /** Permanently close one session and kill its PTY. */
  close: (taskId: string) => Promise<void>;
  /** Permanently close every session for a project (kills PTYs). */
  closeForProject: (projectId: string) => Promise<void>;
  setPtyId: (taskId: string, ptyId: string) => void;
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
 * Compute the start command for a task. For claude-code, embeds either
 * --session-id (first launch) or --resume (subsequent launches) so the
 * conversation survives app restarts. Side effect: generates and persists
 * a session ID if one is missing on a claude-code task (defensive — task
 * creation should have populated it).
 */
export function commandForTask(task: Task): string {
  if (task.agent !== "claude-code") {
    return AGENT_REGISTRY[task.agent].startCommand({
      skipPermissions: task.claudeSkipPermissions,
    });
  }
  const skip = !!task.claudeSkipPermissions;
  const bare = !!task.claudeBareSession;
  const sessionId = task.claudeSessionId;
  if (sessionId) {
    return buildClaudeCommand({ kind: "resume", sessionId, skipPermissions: skip, bareSession: bare });
  }
  const fresh = newSessionId();
  void api
    .updateTask(task.id, { claudeSessionId: fresh })
    .catch((err) => console.warn("[terminal-store] updateTask claudeSessionId failed:", err));
  return buildClaudeCommand({ kind: "new", sessionId: fresh, skipPermissions: skip, bareSession: bare });
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<OpenTerminal[]>([]);
  const [activeByProject, setActiveByProject] = useLocalStorageRecord<string | null>(
    STORAGE_KEYS.terminalActiveByProject,
    "terminal-store"
  );

  useServerEvents(
    useCallback((e) => {
      if (e.type === "task:deleted") {
        const taskId = e.id as string;
        setSessions((prev) => {
          const target = prev.find((p) => p.taskId === taskId);
          if (target) void killPty(target.ptyId);
          return prev.filter((p) => p.taskId !== taskId);
        });
        setActiveByProject((prev) => nullifyMatchingValues(prev, taskId, null));
      } else if (e.type === "project:deleted") {
        const projectId = e.id as string;
        const taskIds = new Set((e.taskIds as string[] | undefined) ?? []);
        setSessions((prev) => {
          const remaining: OpenTerminal[] = [];
          for (const t of prev) {
            if (t.project.id === projectId || taskIds.has(t.taskId)) void killPty(t.ptyId);
            else remaining.push(t);
          }
          return remaining;
        });
        setActiveByProject((prev) => removeKey(prev, projectId));
      }
    }, [setActiveByProject])
  );

  const toggle = useCallback(
    (project: Project, task: Task) => {
      setSessions((prev) => {
        if (prev.some((p) => p.taskId === task.id)) return prev;
        const next: OpenTerminal = {
          taskId: task.id,
          ptyId: null,
          startCommand: commandForTask(task),
          cwd: project.path,
          project,
          task,
        };
        return [...prev, next];
      });
      setActiveByProject((prev) => {
        const curr = prev[project.id] ?? null;
        return { ...prev, [project.id]: curr === task.id ? null : task.id };
      });
    },
    [setActiveByProject]
  );

  const rehydrate = useCallback((project: Project, task: Task) => {
    setSessions((prev) => {
      if (prev.some((p) => p.taskId === task.id)) return prev;
      return [
        ...prev,
        {
          taskId: task.id,
          ptyId: null,
          startCommand: commandForTask(task),
          cwd: project.path,
          project,
          task,
        },
      ];
    });
  }, []);

  const deselect = useCallback(
    (projectId: string) => {
      setActiveByProject((prev) =>
        prev[projectId] === null ? prev : { ...prev, [projectId]: null }
      );
    },
    [setActiveByProject]
  );

  const close = useCallback(
    async (taskId: string) => {
      setSessions((prev) => {
        const target = prev.find((p) => p.taskId === taskId);
        if (target) void killPty(target.ptyId);
        return prev.filter((p) => p.taskId !== taskId);
      });
      setActiveByProject((prev) => nullifyMatchingValues(prev, taskId, null));
    },
    [setActiveByProject]
  );

  const closeForProject = useCallback(
    async (projectId: string) => {
      setSessions((prev) => {
        const remaining: OpenTerminal[] = [];
        for (const t of prev) {
          if (t.project.id === projectId) void killPty(t.ptyId);
          else remaining.push(t);
        }
        return remaining;
      });
      setActiveByProject((prev) => removeKey(prev, projectId));
    },
    [setActiveByProject]
  );

  const setPtyId = useCallback((taskId: string, ptyId: string) => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((p) => {
        if (p.taskId !== taskId) return p;
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
      const electron = getRuntime();
      if (!electron) return;
      const target = sessions.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      await electron.pty.write(target.ptyId, command + "\r", target.project.id);
    },
    [sessions]
  );

  const activeFor = useCallback(
    (projectId: string): OpenTerminal | null => {
      const tid = activeByProject[projectId] ?? null;
      if (!tid) return null;
      return sessions.find((s) => s.taskId === tid && s.project.id === projectId) ?? null;
    },
    [activeByProject, sessions]
  );

  const activeTaskIdFor = useCallback(
    (projectId: string) => activeByProject[projectId] ?? null,
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
