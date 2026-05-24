import type { TaskAgent } from "~/shared/domain";

// Codex has lifecycle hooks, but keep an input fallback because older or
// partially configured Codex builds may not invoke project-local hooks.
// Hook events can still upgrade later transitions when they arrive.
const AGENTS_WITH_LIFECYCLE_HOOKS = new Set<TaskAgent>(["claude-code", "opencode"]);

// Cursor CLI supports hooks, but beforeSubmitPrompt is not wired in cursor-agent
// yet (stop/sessionStart/afterFileEdit work). Capture the first submitted prompt
// from the terminal so titles and icons can still be generated.
const AGENTS_WITH_TERMINAL_PROMPT_FALLBACK = new Set<TaskAgent>(["cursor-cli"]);

export function agentHasLifecycleHooks(agent: TaskAgent): boolean {
  return AGENTS_WITH_LIFECYCLE_HOOKS.has(agent);
}

export function agentUsesTerminalPromptFallback(agent: TaskAgent): boolean {
  return AGENTS_WITH_TERMINAL_PROMPT_FALLBACK.has(agent);
}

export function terminalInputStartsTurn(agent: TaskAgent, data: string): boolean {
  if (agentHasLifecycleHooks(agent)) return false;
  return data.includes("\r") || data.includes("\n");
}
