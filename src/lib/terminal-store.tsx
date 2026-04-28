import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { getElectron } from "./electron";
import { AGENT_META } from "./design-meta";
import type { Project, Task, TaskAgent } from "~/db/schema";

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
  /** The single session currently displayed in the panel, if any. */
  active: OpenTerminal | null;
  activeTaskId: string | null;
  /** Click a card: select if not active, deselect (hide panel) if already active. */
  toggle: (project: Project, task: Task, opts?: { startCommandOverride?: string }) => void;
  /** Deselect the active card and hide the panel without killing the PTY. */
  deselect: () => void;
  /** Permanently close one session and kill its PTY. */
  close: (taskId: string) => Promise<void>;
  /** Permanently close every session for a project (kills PTYs). */
  closeForProject: (projectId: string) => Promise<void>;
  setPtyId: (taskId: string, ptyId: string) => void;
  startCommandFor: (agent: TaskAgent) => string;
  /** Run an arbitrary command in the active PTY for this task. */
  runIn: (taskId: string, command: string) => Promise<void>;
};

const TerminalContext = createContext<Ctx | null>(null);

function commandFor(agent: TaskAgent): string {
  if (agent === "shell") return "";
  return AGENT_META[agent].cmd;
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<OpenTerminal[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (!electron) return;
    await electron.pty.kill(id).catch(() => undefined);
  };

  const toggle = useCallback(
    (project: Project, task: Task, opts?: { startCommandOverride?: string }) => {
      setSessions((prev) => {
        if (prev.some((p) => p.taskId === task.id)) return prev;
        const next: OpenTerminal = {
          taskId: task.id,
          ptyId: null,
          startCommand: opts?.startCommandOverride ?? commandFor(task.agent),
          cwd: project.path,
          project,
          task,
        };
        return [...prev, next];
      });
      setActiveTaskId((curr) => (curr === task.id ? null : task.id));
    },
    []
  );

  const deselect = useCallback(() => {
    setActiveTaskId(null);
  }, []);

  const close = useCallback(async (taskId: string) => {
    setSessions((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
    });
    setActiveTaskId((curr) => (curr === taskId ? null : curr));
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
    setActiveTaskId((curr) => {
      if (!curr) return curr;
      // Clear if the active session was just closed.
      const stillAlive = sessions.some(
        (s) => s.taskId === curr && s.project.id !== projectId
      );
      return stillAlive ? curr : null;
    });
  }, [sessions]);

  const setPtyId = useCallback((taskId: string, ptyId: string) => {
    setSessions((prev) => prev.map((p) => (p.taskId === taskId ? { ...p, ptyId } : p)));
  }, []);

  const runIn = useCallback(
    async (taskId: string, command: string) => {
      const electron = getElectron();
      if (!electron) return;
      const target = sessions.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      await electron.pty.write(target.ptyId, command + "\r");
    },
    [sessions]
  );

  const active = activeTaskId
    ? sessions.find((s) => s.taskId === activeTaskId) ?? null
    : null;

  return (
    <TerminalContext.Provider
      value={{
        sessions,
        active,
        activeTaskId,
        toggle,
        deselect,
        close,
        closeForProject,
        setPtyId,
        startCommandFor: commandFor,
        runIn,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminals() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminals must be used inside TerminalProvider");
  return ctx;
}
