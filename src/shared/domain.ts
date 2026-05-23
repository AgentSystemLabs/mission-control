export const TASK_AGENTS = ["claude-code", "codex", "cursor-cli", "opencode"] as const;
export type TaskAgent = (typeof TASK_AGENTS)[number];

export const TASK_STATUSES = [
  "ready",
  "running",
  "needs-input",
  "interrupted",
  "finished",
  "terminated",
  "disconnected",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = "ready";
export const DEFAULT_BRANCH = "main";

export type TaskStatusMeta = {
  label: string;
  color: string;
  dot: boolean;
  shimmer: boolean;
  displayOrder: number;
  selectionPriority: number;
  countsAsActive: boolean;
  isTerminal: boolean;
};

export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  ready: {
    label: "Ready",
    color: "var(--status-ready)",
    dot: true,
    shimmer: false,
    displayOrder: 1,
    selectionPriority: 2,
    countsAsActive: true,
    isTerminal: false,
  },
  running: {
    label: "Running",
    color: "var(--status-running)",
    dot: true,
    shimmer: true,
    displayOrder: 2,
    selectionPriority: 1,
    countsAsActive: true,
    isTerminal: false,
  },
  "needs-input": {
    label: "Needs input",
    color: "var(--status-needs)",
    dot: true,
    shimmer: false,
    displayOrder: 0,
    selectionPriority: 0,
    countsAsActive: true,
    isTerminal: false,
  },
  interrupted: {
    label: "Interrupted",
    color: "var(--status-interrupted)",
    dot: true,
    shimmer: false,
    displayOrder: 0.5,
    selectionPriority: 0.5,
    countsAsActive: true,
    isTerminal: false,
  },
  finished: {
    label: "Finished",
    color: "var(--status-done)",
    dot: true,
    shimmer: false,
    displayOrder: 3,
    selectionPriority: 3,
    countsAsActive: true,
    isTerminal: false,
  },
  terminated: {
    label: "Terminated",
    color: "var(--status-idle)",
    dot: false,
    shimmer: false,
    displayOrder: 4,
    selectionPriority: 4,
    countsAsActive: false,
    isTerminal: true,
  },
  disconnected: {
    label: "Disconnected",
    color: "var(--status-idle)",
    dot: true,
    shimmer: false,
    displayOrder: 5,
    selectionPriority: 5,
    countsAsActive: true,
    isTerminal: false,
  },
};

export const STATUS_DISPLAY_ORDER = [...TASK_STATUSES].sort(
  (a, b) => TASK_STATUS_META[a].displayOrder - TASK_STATUS_META[b].displayOrder
);

export const STATUS_SELECTION_PRIORITY = [...TASK_STATUSES].sort(
  (a, b) => TASK_STATUS_META[a].selectionPriority - TASK_STATUS_META[b].selectionPriority
);

export const ACTIVE_STATUSES = TASK_STATUSES.filter((s) => TASK_STATUS_META[s].countsAsActive);
export const TERMINAL_STATUSES = TASK_STATUSES.filter((s) => TASK_STATUS_META[s].isTerminal);

export const isTaskAgent = (value: unknown): value is TaskAgent =>
  typeof value === "string" && (TASK_AGENTS as readonly string[]).includes(value);

export const isTaskStatus = (value: unknown): value is TaskStatus =>
  typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);

export const isActiveStatus = (s: TaskStatus) => TASK_STATUS_META[s].countsAsActive;
export const isTerminalStatus = (s: TaskStatus) => TASK_STATUS_META[s].isTerminal;

export const LAUNCH_COMMANDS_MAX = 5;
export type LaunchCommand = { id: string; name: string; command: string };

export function parseLaunchCommands(raw: string | null | undefined): LaunchCommand[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (c) =>
          c &&
          typeof c.id === "string" &&
          typeof c.name === "string" &&
          typeof c.command === "string"
      )
      .slice(0, LAUNCH_COMMANDS_MAX);
  } catch {
    return [];
  }
}
