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
  visible: boolean;
};

type Ctx = {
  /** Only the currently visible terminals; hidden sessions stay alive in the background. */
  open: OpenTerminal[];
  isOpen: (taskId: string) => boolean;
  /** Hide if visible, show if hidden, create if no session exists. Never kills the PTY. */
  toggle: (project: Project, task: Task) => void;
  /** Permanently close the session and kill its PTY. */
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
  // All sessions, both visible and hidden. Hidden ones keep their PTY alive in
  // the main process so the underlying agent (e.g. Claude) is not restarted
  // when the panel is collapsed and reopened.
  const [sessions, setSessions] = useState<OpenTerminal[]>([]);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (!electron) return;
    await electron.pty.kill(id).catch(() => undefined);
  };

  const toggle = useCallback((project: Project, task: Task) => {
    setSessions((prev) => {
      const existing = prev.find((p) => p.taskId === task.id);
      if (existing) {
        // Just flip visibility — keep the PTY alive in the background.
        return prev.map((p) =>
          p.taskId === task.id ? { ...p, visible: !p.visible } : p
        );
      }
      const next: OpenTerminal = {
        taskId: task.id,
        ptyId: null,
        startCommand: commandFor(task.agent),
        cwd: project.path,
        project,
        task,
        visible: true,
      };
      const arr = [...prev, next];
      // Cap the number of *visible* panes; bump the oldest visible one to hidden
      // (still alive) rather than killing it.
      const visibleCount = arr.filter((p) => p.visible).length;
      if (visibleCount > MAX_PANES) {
        for (const p of arr) {
          if (p.visible && p.taskId !== task.id) {
            p.visible = false;
            break;
          }
        }
      }
      return arr;
    });
  }, []);

  const close = useCallback(async (taskId: string) => {
    setSessions((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
    });
  }, []);

  const closeAll = useCallback(async () => {
    setSessions((prev) => {
      for (const t of prev) void killPty(t.ptyId);
      return [];
    });
  }, []);

  const closeForProject = useCallback(async (projectId: string) => {
    setSessions((prev) => {
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
    setSessions((prev) => prev.map((p) => (p.taskId === taskId ? { ...p, ptyId } : p)));
  }, []);

  // `open` reflects only what the panel renders; hidden sessions are excluded
  // but remain in `sessions` so their PTYs stay alive.
  const open = sessions.filter((p) => p.visible);

  const isOpen = useCallback(
    (taskId: string) => sessions.some((p) => p.taskId === taskId && p.visible),
    [sessions]
  );

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
