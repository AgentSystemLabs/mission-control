import type { TaskAgent } from "~/shared/domain";

// Codex has lifecycle hooks, but keep an input fallback because older or
// partially configured Codex builds may not invoke project-local hooks.
// Hook events can still upgrade later transitions when they arrive.
const AGENTS_WITH_LIFECYCLE_HOOKS = new Set<TaskAgent>(["claude-code", "opencode"]);

// Cursor CLI installs .cursor/hooks.json (beforeSubmitPrompt/stop/sessionStart),
// but beforeSubmitPrompt still does not fire in cursor-agent — only stop /
// sessionStart / tool hooks do. Capture submitted prompts from the terminal so
// titles and icons can still be generated, and use Enter as the running signal.
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

/**
 * Clear the Enter→running one-shot latch once the task is no longer running.
 * Without this, a second prompt in the same Cursor session never flips the
 * card back to running after stop → finished.
 */
export function shouldResetTerminalRunningFallback(currentStatus: string): boolean {
  return currentStatus !== "running";
}
