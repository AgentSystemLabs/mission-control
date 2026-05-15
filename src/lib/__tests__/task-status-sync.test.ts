import { describe, expect, it } from "vitest";
import { agentHasLifecycleHooks, terminalInputStartsTurn } from "../task-status-sync";

describe("terminal status sync", () => {
  it("lets Claude Code report running through lifecycle hooks", () => {
    expect(agentHasLifecycleHooks("claude-code")).toBe(true);
    expect(terminalInputStartsTurn("claude-code", "\r")).toBe(false);
  });

  it("marks input-driven agents as running when the user submits input", () => {
    expect(agentHasLifecycleHooks("cursor-cli")).toBe(false);
    expect(agentHasLifecycleHooks("codex")).toBe(false);
    expect(terminalInputStartsTurn("cursor-cli", "hello")).toBe(false);
    expect(terminalInputStartsTurn("cursor-cli", "implement this\r")).toBe(true);
    expect(terminalInputStartsTurn("codex", "\r")).toBe(true);
  });
});
