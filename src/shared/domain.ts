import { safeJsonParse } from "./safe-json";

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

// Custom scripts extend launch commands with optional run-time arguments: each
// arg is a `$NAME` placeholder in the command that the user fills in via a modal
// before the script runs. They run individually on demand (header split button)
// and have no launch/stop lifecycle, where launch commands run as a managed group.
export const CUSTOM_SCRIPTS_MAX = 5;
// Generous upper bound so a malformed/abusive payload can't store an unbounded
// arg list; "as many as they want" in practice means "as many as fit here".
export const SCRIPT_ARGS_MAX = 20;

/** A single fill-in-the-blank for a custom script, referenced as `$name` in the command. */
export type ScriptArg = { name: string; description?: string };
export type CustomScript = LaunchCommand & { args?: ScriptArg[] };

/** Arg names must be shell-identifier-like so `$NAME` substitution is unambiguous. */
export function isValidScriptArgName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function parseCommandList(raw: string | null | undefined, max: number): LaunchCommand[] {
  const v = safeJsonParse(raw, [] as unknown);
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (c) =>
        c &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.command === "string"
    )
    .slice(0, max);
}

export function parseLaunchCommands(raw: string | null | undefined): LaunchCommand[] {
  return parseCommandList(raw, LAUNCH_COMMANDS_MAX);
}

/**
 * Validate and normalize an untrusted arg list: keeps only entries with a
 * valid, unique name, trims descriptions, caps the count, and returns
 * `undefined` (rather than `[]`) when nothing survives so callers can omit the
 * field entirely. Shared by the parser, the persistence layer, and the dialog.
 */
export function normalizeScriptArgs(raw: unknown): ScriptArg[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ScriptArg[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a.name !== "string") continue;
    const name = a.name.trim();
    if (!isValidScriptArgName(name) || seen.has(name)) continue;
    seen.add(name);
    const description =
      typeof a.description === "string" && a.description.trim()
        ? a.description.trim()
        : undefined;
    out.push(description ? { name, description } : { name });
    if (out.length >= SCRIPT_ARGS_MAX) break;
  }
  return out.length > 0 ? out : undefined;
}

export function parseCustomScripts(raw: string | null | undefined): CustomScript[] {
  return parseCommandList(raw, CUSTOM_SCRIPTS_MAX).map((c) => {
    const args = normalizeScriptArgs((c as { args?: unknown }).args);
    return args ? { ...c, args } : c;
  });
}

export function serializeCustomScripts(scripts: CustomScript[]): string | null {
  return scripts.length === 0 ? null : JSON.stringify(scripts);
}

/**
 * Replace `$name` / `${name}` placeholders in a command with the user-supplied
 * values. Single pass so a substituted value containing `$x` is never
 * re-expanded; tokens with no matching value (real shell vars like `$HOME`) are
 * left untouched.
 */
export function substituteScriptArgs(
  command: string,
  values: Record<string, string>
): string {
  // Token grammar matches the arg-name grammar (isValidScriptArgName) so a token
  // can only ever resolve to a value a valid arg could have produced.
  return command.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (match, braced, bare) => {
    const name = (braced ?? bare) as string;
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : match;
  });
}
