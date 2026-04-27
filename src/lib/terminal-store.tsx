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
  /** Sessions currently rendered in the panel (visible & panel not collapsed). */
  open: OpenTerminal[];
  /** All sessions in the tray, regardless of panel-collapsed or per-session visibility. */
  selected: OpenTerminal[];
  isSelected: (taskId: string) => boolean;
  /** Add to tray if absent, remove (and kill PTY) if present. */
  toggle: (project: Project, task: Task, opts?: { startCommandOverride?: string }) => void;
  /** Permanently close one session and kill its PTY. */
  close: (taskId: string) => Promise<void>;
  /** Permanently close every session for a project (kills PTYs, clears tray). */
  closeForProject: (projectId: string) => Promise<void>;
  setPtyId: (taskId: string, ptyId: string) => void;
  startCommandFor: (agent: TaskAgent) => string;
  /** Run an arbitrary command in the active PTY for this task. */
  runIn: (taskId: string, command: string) => Promise<void>;
  /** Whether the right agent panel is collapsed (sessions stay alive). */
  panelCollapsed: boolean;
  togglePanel: () => void;
  setPanelCollapsed: (collapsed: boolean) => void;
};

const TerminalContext = createContext<Ctx | null>(null);

const MAX_PANES = 4;
const PANEL_COLLAPSED_KEY = "mc:agentsPanelCollapsed";

function commandFor(agent: TaskAgent): string {
  if (agent === "shell") return "";
  return AGENT_META[agent].cmd;
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<OpenTerminal[]>([]);
  const [panelCollapsed, setPanelCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const persistCollapsed = (value: boolean) => {
    try {
      window.localStorage.setItem(PANEL_COLLAPSED_KEY, value ? "1" : "0");
    } catch {}
  };

  const setPanelCollapsed = useCallback((collapsed: boolean) => {
    setPanelCollapsedState(collapsed);
    persistCollapsed(collapsed);
  }, []);

  const togglePanel = useCallback(() => {
    setPanelCollapsedState((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  }, []);

  const killPty = async (id: string | null) => {
    if (!id) return;
    const electron = getElectron();
    if (!electron) return;
    await electron.pty.kill(id).catch(() => undefined);
  };

  const toggle = useCallback((project: Project, task: Task, opts?: { startCommandOverride?: string }) => {
    let toKill: string | null = null;
    let added = false;
    setSessions((prev) => {
      const existing = prev.find((p) => p.taskId === task.id);
      if (existing) {
        toKill = existing.ptyId;
        return prev.filter((p) => p.taskId !== task.id);
      }
      added = true;
      const next: OpenTerminal = {
        taskId: task.id,
        ptyId: null,
        startCommand: opts?.startCommandOverride ?? commandFor(task.agent),
        cwd: project.path,
        project,
        task,
        visible: true,
      };
      const arr = [...prev, next];
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
    if (toKill) void killPty(toKill);
    if (added) setPanelCollapsed(false);
  }, [setPanelCollapsed]);

  const close = useCallback(async (taskId: string) => {
    setSessions((prev) => {
      const target = prev.find((p) => p.taskId === taskId);
      if (target) void killPty(target.ptyId);
      return prev.filter((p) => p.taskId !== taskId);
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

  const visibleSessions = sessions.filter((p) => p.visible);
  const open = panelCollapsed ? [] : visibleSessions;

  const isSelected = useCallback(
    (taskId: string) => sessions.some((p) => p.taskId === taskId),
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
        selected: sessions,
        isSelected,
        toggle,
        close,
        closeForProject,
        setPtyId,
        startCommandFor: commandFor,
        runIn,
        panelCollapsed,
        togglePanel,
        setPanelCollapsed,
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
