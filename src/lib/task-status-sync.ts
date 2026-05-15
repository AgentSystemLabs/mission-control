import type { TaskAgent } from "~/shared/domain";

// Codex has lifecycle hooks, but keep an input fallback because older or
// partially configured Codex builds may not invoke project-local hooks.
// Hook events can still upgrade later transitions when they arrive.
const AGENTS_WITH_LIFECYCLE_HOOKS = new Set<TaskAgent>(["claude-code"]);

export function agentHasLifecycleHooks(agent: TaskAgent): boolean {
  return AGENTS_WITH_LIFECYCLE_HOOKS.has(agent);
}

export function terminalInputStartsTurn(agent: TaskAgent, data: string): boolean {
  if (agentHasLifecycleHooks(agent)) return false;
  return data.includes("\r") || data.includes("\n");
}
