import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareUserTerminalWarmSlot,
  userTerminalWarmSignature,
} from "../user-terminal-warm-pool";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("user-terminal-warm-pool", () => {
  it("keys warm slots by runtime scope and cwd", () => {
    expect(userTerminalWarmSignature("/Users/dev/project")).toBe("local\0/Users/dev/project");
    expect(userTerminalWarmSignature("/tmp/worktree-a")).not.toBe(
      userTerminalWarmSignature("/tmp/worktree-b"),
    );
    expect(userTerminalWarmSignature("/tmp/worktree-a", "sb-1")).not.toBe(
      userTerminalWarmSignature("/tmp/worktree-a", "local"),
    );
  });

  it("does not pre-spawn a host warm terminal while Docker sandbox runtime is active", async () => {
    const spawn = vi.fn();
    vi.stubGlobal("window", {
      electronAPI: {
        sandbox: { getState: vi.fn().mockResolvedValue({ status: "connected" }) },
        pty: { spawn, kill: vi.fn() },
      },
    });

    await expect(
      prepareUserTerminalWarmSlot({
        project: { id: "p1", activeWorktreeId: null } as never,
        cwd: "/Users/dev/project",
      }),
    ).resolves.toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});
