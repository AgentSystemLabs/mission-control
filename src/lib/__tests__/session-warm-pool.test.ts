import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSessionPayload, prepareSessionWarmSlot } from "../session-warm-pool";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session-warm-pool", () => {
  it("builds default payload from saved agent settings", () => {
    expect(
      defaultSessionPayload({
        branch: "main",
        rememberAgentSettings: true,
        savedAgent: "codex",
        savedSkipPermissions: true,
      }),
    ).toEqual({
      agent: "codex",
      branch: "main",
      skipPermissions: true,
      bareSession: false,
    });
  });

  it("falls back to claude-code when nothing is saved", () => {
    expect(
      defaultSessionPayload({
        branch: "dev",
        rememberAgentSettings: false,
      }),
    ).toEqual({
      agent: "claude-code",
      branch: "dev",
      skipPermissions: false,
      bareSession: false,
    });
  });

  it("does not pre-spawn a host session while Docker sandbox runtime is active", async () => {
    const spawn = vi.fn();
    vi.stubGlobal("window", {
      electronAPI: {
        sandbox: { getState: vi.fn().mockResolvedValue({ status: "connected" }) },
        pty: { spawn, kill: vi.fn() },
      },
    });

    await expect(
      prepareSessionWarmSlot({
        project: { id: "p1", path: "/Users/dev/project", activeWorktreeId: null } as never,
        payload: {
          agent: "claude-code",
          branch: "main",
          skipPermissions: false,
          bareSession: false,
        },
      }),
    ).resolves.toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});
