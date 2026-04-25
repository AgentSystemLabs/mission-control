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
  open: OpenTerminal[];
  isOpen: (taskId: string) => boolean;
  toggle: (project: Project, task: Task) => void;
  close: (taskId: string) => Promise<void>;
  closeAll: () => Promise<void>;
  setPtyId: (taskId: string, ptyId: string) => void;
  closeForProject: (projectId: string) => Promise<void>;
  startCommandFor: (agent: TaskAgent) => string;
  /** Run an arbitrary command in the active PTY for this task. */
  runIn: (taskId: string, command: string) => Promise<void>;
};

const TerminalContext = createContext<Ctx | null>(null);

const MAX_PANES = 4;

function commandFor(agent: TaskAgent): string {
  if (agent === "shell") return "";
  return AGENT_META[agent].cmd;
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenTerminal[]>([]);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (!electron) return;
    await electron.pty.kill(id).catch(() => undefined);
  };

  const toggle = useCallback((project: Project, task: Task) => {
    setOpen((prev) => {
      const existing = prev.find((p) => p.taskId === task.id);
      if (existing) {
        void killPty(existing.ptyId);
        return prev.filter((p) => p.taskId !== task.id);
      }
      const next: OpenTerminal = {
        taskId: task.id,
        ptyId: null,
        startCommand: commandFor(task.agent),
        cwd: project.path,
        project,
        task,
      };
      const arr = [...prev, next];
      while (arr.length > MAX_PANES) {
        const dropped = arr.shift();
        if (dropped) void killPty(dropped.ptyId);
      }
      return arr;
    });
  }, []);

  const close = useCallback(async (taskId: string) => {
    setOpen((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
    });
  }, []);

  const closeAll = useCallback(async () => {
    setOpen((prev) => {
      for (const t of prev) void killPty(t.ptyId);
      return [];
    });
  }, []);

  const closeForProject = useCallback(async (projectId: string) => {
    setOpen((prev) => {
      const remaining: OpenTerminal[] = [];
      for (const t of prev) {
        if (t.project.id === projectId) {
          void killPty(t.ptyId);
        } else {
          remaining.push(t);
        }
      }
      return remaining;
    });
  }, []);

  const setPtyId = useCallback((taskId: string, ptyId: string) => {
    setOpen((prev) => prev.map((p) => (p.taskId === taskId ? { ...p, ptyId } : p)));
  }, []);

  const isOpen = useCallback(
    (taskId: string) => open.some((p) => p.taskId === taskId),
    [open]
  );

  const runIn = useCallback(
    async (taskId: string, command: string) => {
      const electron = getElectron();
      if (!electron) return;
      const target = open.find((p) => p.taskId === taskId);
      if (!target?.ptyId) return;
      await electron.pty.write(target.ptyId, command + "\r");
    },
    [open]
  );

  return (
    <TerminalContext.Provider
      value={{
        open,
        isOpen,
        toggle,
        close,
        closeAll,
        setPtyId,
        closeForProject,
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
