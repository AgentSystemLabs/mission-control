import { AGENT_REGISTRY } from "~/shared/agents";
import { STATUS_SELECTION_PRIORITY, TASK_STATUS_META, type TaskAgent, type TaskStatus } from "~/shared/domain";

export { STATUS_SELECTION_PRIORITY } from "~/shared/domain";

export const AGENT_META: Record<TaskAgent, { label: string; color: string; glyph: string; cmd: string }> = {
  "claude-code": metaFor("claude-code"),
  codex: metaFor("codex"),
  "cursor-cli": metaFor("cursor-cli"),
};

export const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; dot: boolean; shimmer: boolean }
> = {
  ready: TASK_STATUS_META.ready,
  running: TASK_STATUS_META.running,
  "needs-input": TASK_STATUS_META["needs-input"],
  interrupted: TASK_STATUS_META.interrupted,
  finished: TASK_STATUS_META.finished,
  terminated: TASK_STATUS_META.terminated,
  disconnected: TASK_STATUS_META.disconnected,
};

// Order used to pick the "next most attention-worthy" session — e.g. when
// cycling into a closed panel via Cmd+Shift+]/[ or after closing the active
// session. Distinct from display order: running outranks ready because a live
// agent matters more than a queued one.
/** Pick the highest-priority task per `STATUS_SELECTION_PRIORITY`. */
export function pickByPriority<T extends { status: TaskStatus }>(tasks: T[]): T | undefined {
  for (const status of STATUS_SELECTION_PRIORITY) {
    const found = tasks.find((t) => t.status === status);
    if (found) return found;
  }
  return undefined;
}

export const DUPLICATE_ACTIVE_SESSION_EVENT = "mc:duplicate-active-session";

export const ICON_COLORS = ["#ff5a1f", "#8ab4ff", "#c792ea", "#ff9466", "#f472b6", "#34d399", "#fb923c"];
export const GROUP_COLORS = ["#ff5a1f", "#8ab4ff", "#c792ea", "#ff9466", "#f472b6", "#34d399", "#fb923c"];

function metaFor(agent: TaskAgent) {
  const meta = AGENT_REGISTRY[agent];
  return { label: meta.label, color: meta.color, glyph: meta.glyph, cmd: meta.command };
}
