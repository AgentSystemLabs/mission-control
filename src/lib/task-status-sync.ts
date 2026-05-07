import type { TaskAgent } from "~/shared/domain";

const AGENTS_WITH_LIFECYCLE_HOOKS = new Set<TaskAgent>(["claude-code", "codex"]);

export function agentHasLifecycleHooks(agent: TaskAgent): boolean {
  return AGENTS_WITH_LIFECYCLE_HOOKS.has(agent);
}

export function terminalInputStartsTurn(agent: TaskAgent, data: string): boolean {
  if (agentHasLifecycleHooks(agent)) return false;
  return data.includes("\r") || data.includes("\n");
}
