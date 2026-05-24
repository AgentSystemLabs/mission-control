import { describe, expect, it } from "vitest";
import { userTerminalWarmSignature } from "../user-terminal-warm-pool";

describe("user-terminal-warm-pool", () => {
  it("keys warm slots by cwd only", () => {
    expect(userTerminalWarmSignature("/Users/dev/project")).toBe("/Users/dev/project");
    expect(userTerminalWarmSignature("/tmp/worktree-a")).not.toBe(
      userTerminalWarmSignature("/tmp/worktree-b"),
    );
  });
});
