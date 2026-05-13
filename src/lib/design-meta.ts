import { AGENT_REGISTRY } from "~/shared/agents";
import { STATUS_SELECTION_PRIORITY, type TaskAgent, type TaskStatus } from "~/shared/domain";

export { STATUS_SELECTION_PRIORITY } from "~/shared/domain";

export const AGENT_META: Record<TaskAgent, { label: string; color: string; glyph: string; cmd: string }> = {
  "claude-code": metaFor("claude-code"),
  codex: metaFor("codex"),
  "cursor-cli": metaFor("cursor-cli"),
  shell: metaFor("shell"),
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

// Single source of truth for our orange-leaning brand palette — used for
// per-project icon tinting and for picking a default group color.
export const BRAND_PALETTE = [
  "#ff5a1f",
  "#8ab4ff",
  "#c792ea",
  "#ff9466",
  "#f472b6",
  "#34d399",
  "#fb923c",
] as const;

function metaFor(agent: TaskAgent) {
  const meta = AGENT_REGISTRY[agent];
  return { label: meta.label, color: meta.color, glyph: meta.glyph, cmd: meta.command };
}
