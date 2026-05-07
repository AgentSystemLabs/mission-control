import { describe, expect, it } from "vitest";
import { agentHasLifecycleHooks, terminalInputStartsTurn } from "../task-status-sync";

describe("terminal status sync", () => {
  it("lets hook-capable agents report running through lifecycle hooks", () => {
    expect(agentHasLifecycleHooks("claude-code")).toBe(true);
    expect(agentHasLifecycleHooks("codex")).toBe(true);
    expect(terminalInputStartsTurn("claude-code", "\r")).toBe(false);
    expect(terminalInputStartsTurn("codex", "\r")).toBe(false);
  });

  it("marks Cursor CLI as running when the user submits input", () => {
    expect(agentHasLifecycleHooks("cursor-cli")).toBe(false);
    expect(terminalInputStartsTurn("cursor-cli", "hello")).toBe(false);
    expect(terminalInputStartsTurn("cursor-cli", "implement this\r")).toBe(true);
  });
});
