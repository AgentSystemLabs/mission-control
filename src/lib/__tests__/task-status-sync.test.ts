import { describe, expect, it } from "vitest";
import {
  agentHasLifecycleHooks,
  agentUsesTerminalPromptFallback,
  shouldResetTerminalRunningFallback,
  terminalInputStartsTurn,
} from "../task-status-sync";

describe("terminal status sync", () => {
  it("lets Claude Code report running through lifecycle hooks", () => {
    expect(agentHasLifecycleHooks("claude-code")).toBe(true);
    expect(terminalInputStartsTurn("claude-code", "\r")).toBe(false);
  });

  it("lets OpenCode report status through plugin hooks", () => {
    expect(agentHasLifecycleHooks("opencode")).toBe(true);
    expect(terminalInputStartsTurn("opencode", "\r")).toBe(false);
  });

  it("marks input-driven agents as running when the user submits input", () => {
    expect(agentHasLifecycleHooks("cursor-cli")).toBe(false);
    expect(agentUsesTerminalPromptFallback("cursor-cli")).toBe(true);
    expect(agentHasLifecycleHooks("codex")).toBe(false);
    expect(agentUsesTerminalPromptFallback("codex")).toBe(false);
    expect(terminalInputStartsTurn("cursor-cli", "hello")).toBe(false);
    expect(terminalInputStartsTurn("cursor-cli", "implement this\r")).toBe(true);
    expect(terminalInputStartsTurn("codex", "\r")).toBe(true);
  });

  it("re-arms the Enter→running fallback after a turn leaves running", () => {
    expect(shouldResetTerminalRunningFallback("running")).toBe(false);
    // stop/afterAgentResponse flipped the card to finished → clear the latch
    // so the next Enter in the same session can post running again.
    expect(shouldResetTerminalRunningFallback("finished")).toBe(true);
    expect(shouldResetTerminalRunningFallback("needs-input")).toBe(true);
    expect(shouldResetTerminalRunningFallback("ready")).toBe(true);
  });
});
