import { TASK_AGENTS, type TaskAgent } from "./domain";

/**
 * User preference for the New Session agent picker: display order plus a set
 * of hidden agents. Hiding only removes an agent from the picker — a project's
 * saved agent still launches through the skip-dialog path.
 */
export type AgentLauncherConfig = {
  order: TaskAgent[];
  hidden: TaskAgent[];
};

export const DEFAULT_AGENT_LAUNCHER_CONFIG: AgentLauncherConfig = {
  order: [...TASK_AGENTS],
  hidden: [],
};

const TASK_AGENT_SET = new Set<string>(TASK_AGENTS);

function toAgentList(value: unknown): TaskAgent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<TaskAgent>();
  for (const entry of value) {
    if (typeof entry === "string" && TASK_AGENT_SET.has(entry)) {
      seen.add(entry as TaskAgent);
    }
  }
  return [...seen];
}

/**
 * Coerce any stored/posted value into a valid config: unknown ids and
 * duplicates are dropped, agents missing from `order` are appended in default
 * order, and at least one agent is always left visible.
 */
export function normalizeAgentLauncherConfig(raw: unknown): AgentLauncherConfig {
  if (typeof raw !== "object" || raw === null) {
    return {
      order: [...DEFAULT_AGENT_LAUNCHER_CONFIG.order],
      hidden: [],
    };
  }
  const input = raw as { order?: unknown; hidden?: unknown };
  const order = toAgentList(input.order);
  for (const agent of TASK_AGENTS) {
    if (!order.includes(agent)) order.push(agent);
  }
  const orderSet = new Set(order);
  let hidden = toAgentList(input.hidden).filter((agent) => orderSet.has(agent));
  if (hidden.length >= order.length) {
    hidden = hidden.filter((agent) => agent !== order[0]);
  }
  return { order, hidden };
}

/** Agents to show in the picker, in configured order. Never empty. */
export function visibleLauncherAgents(config: AgentLauncherConfig): TaskAgent[] {
  const hidden = new Set(config.hidden);
  return config.order.filter((agent) => !hidden.has(agent));
}
