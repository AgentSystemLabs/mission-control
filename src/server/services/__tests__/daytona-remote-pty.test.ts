import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedAuthContext } from "../../hosted-auth-context";

const daytonaGet = vi.hoisted(() => vi.fn());
const daytonaCreate = vi.hoisted(() => vi.fn());
const daytonaStart = vi.hoisted(() => vi.fn());
const daytonaDelete = vi.hoisted(() => vi.fn());
const createPty = vi.hoisted(() => vi.fn());
const executeCommand = vi.hoisted(() => vi.fn());
const readEntitlements = vi.hoisted(() => vi.fn());
const hostedComputeLimitStatus = vi.hoisted(() => vi.fn());
const recordHostedRuntimeStart = vi.hoisted(() => vi.fn());
const recordHostedRuntimeEnd = vi.hoisted(() => vi.fn());
const logHostedEvent = vi.hoisted(() => vi.fn());
const incrementHostedCounter = vi.hoisted(() => vi.fn());
const setHostedGauge = vi.hoisted(() => vi.fn());

vi.mock("@daytona/sdk", () => ({
  Daytona: vi.fn(function Daytona() {
    return {
      get: daytonaGet,
      create: daytonaCreate,
      start: daytonaStart,
      delete: daytonaDelete,
    };
  }),
  DaytonaNotFoundError: class DaytonaNotFoundError extends Error {},
}));

vi.mock("../hosted-plan-limits", () => ({
  hostedComputeLimitStatus,
}));

vi.mock("../entitlements", () => ({
  readEntitlements,
}));

vi.mock("../hosted-runtime-usage", () => ({
  recordHostedRuntimeStart,
  recordHostedRuntimeEnd,
}));

vi.mock("../hosted-logs", () => ({
  logHostedEvent,
}));

vi.mock("../hosted-metrics", () => ({
  incrementHostedCounter,
  setHostedGauge,
}));

vi.mock("../remote-agent-hooks", () => ({
  installRemoteAgentHooks: vi.fn(),
}));

vi.mock("../hosted-hook-tokens", () => ({
  revokeHostedHookTokens: vi.fn(),
}));

const { DaytonaNotFoundError } = await import("@daytona/sdk");
const {
  countActiveRemotePtys,
  ensureRemoteProjectRepository,
  killRemotePtysForProject,
  resetDaytonaRemotePtyStateForTests,
  resizeRemotePty,
  spawnRemotePty,
} = await import("../daytona-remote-pty");

const context: HostedAuthContext = {
  sessionId: "hs-1",
  academyUserId: "academy-user-1",
  userId: "user-1",
  email: "user@example.com",
  organizationId: null,
};

function pty() {
  return {
    waitForConnection: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn(() => new Promise(() => undefined)),
    kill: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Daytona remote PTY compute limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDaytonaRemotePtyStateForTests();
    vi.clearAllMocks();
    process.env.DAYTONA_API_KEY = "daytona-test-key";
    process.env.MC_COMPUTE_LIMIT_POLL_MS = "1";
    executeCommand.mockResolvedValue({ exitCode: 0, result: "" });
    readEntitlements.mockResolvedValue({
      hosted: { enabled: true, userId: "user-1", organizationId: null },
      remoteRuntime: {
        allowed: true,
        reason: null,
        plan: "paid",
        trialEndsAt: null,
      },
    });
    recordHostedRuntimeStart.mockResolvedValue(undefined);
    recordHostedRuntimeEnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_SNAPSHOT;
    delete process.env.DAYTONA_AUTO_STOP_MINUTES;
    delete process.env.MC_COMPUTE_LIMIT_POLL_MS;
    vi.useRealTimers();
  });

  it("kills an active Daytona PTY when the monthly compute limit is reached", async () => {
    const fakePty = pty();
    createPty.mockResolvedValue(fakePty);
    daytonaGet.mockResolvedValue({
      id: "sandbox-1",
      state: "started",
      process: { createPty, executeCommand },
    });
    hostedComputeLimitStatus.mockResolvedValue({
      allowed: false,
      tier: "mission_control_cloud",
      limitSeconds: 3600,
      usedSeconds: 3600,
      windowDays: 30,
      currentPeriodStartsAt: "2026-05-01T00:00:00.000Z",
    });

    const { ptyId } = await spawnRemotePty({
      context,
      projectId: "hp-1",
      cwd: "/home/workspace/project",
      command: "pwd",
    });

    expect(countActiveRemotePtys(context)).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    expect(fakePty.kill).toHaveBeenCalled();
    expect(fakePty.disconnect).toHaveBeenCalled();
    expect(recordHostedRuntimeEnd).toHaveBeenCalledWith(ptyId);
    expect(countActiveRemotePtys(context)).toBe(0);
    expect(logHostedEvent).toHaveBeenCalledWith(
      "remote_pty.compute_limit_reached",
      expect.objectContaining({
        ptyId,
        userId: "user-1",
        currentPeriodStartsAt: "2026-05-01T00:00:00.000Z",
      }),
      "warn",
    );
  });

  it("kills an active Daytona PTY when hosted runtime access is revoked", async () => {
    const fakePty = pty();
    createPty.mockResolvedValue(fakePty);
    daytonaGet.mockResolvedValue({
      id: "sandbox-1",
      state: "started",
      process: { createPty, executeCommand },
    });
    readEntitlements.mockResolvedValueOnce({
      hosted: { enabled: true, userId: "user-1", organizationId: null },
      remoteRuntime: {
        allowed: false,
        reason: "subscription-required",
        plan: "none",
        trialEndsAt: null,
      },
    });

    const { ptyId } = await spawnRemotePty({
      context,
      projectId: "hp-1",
      cwd: "/home/workspace/project",
      command: "pwd",
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(fakePty.kill).toHaveBeenCalled();
    expect(hostedComputeLimitStatus).not.toHaveBeenCalled();
    expect(logHostedEvent).toHaveBeenCalledWith(
      "remote_pty.entitlement_revoked",
      expect.objectContaining({
        ptyId,
        reason: "subscription-required",
      }),
      "warn",
    );
  });

  it("clones a GitHub repository before spawning a remote PTY", async () => {
    const fakePty = pty();
    const gitStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("not a git repository"))
      .mockResolvedValueOnce({ currentBranch: "main" });
    const gitClone = vi.fn().mockResolvedValue(undefined);
    createPty.mockResolvedValue(fakePty);
    daytonaGet.mockResolvedValue({
      id: "sandbox-1",
      state: "started",
      process: { createPty, executeCommand },
      git: { status: gitStatus, clone: gitClone },
    });
    hostedComputeLimitStatus.mockResolvedValue({
      allowed: true,
      tier: "mission_control_cloud",
      limitSeconds: 3600,
      usedSeconds: 120,
      windowDays: 30,
      currentPeriodStartsAt: "2026-05-01T00:00:00.000Z",
    });

    await spawnRemotePty({
      context,
      projectId: "hp-clone",
      cwd: "/home/workspace/repo",
      command: "pwd",
      githubUrl: "https://github.com/example/repo",
    });

    expect(executeCommand).toHaveBeenCalledWith("mkdir -p '/home/workspace'", "/", undefined, 30);
    expect(gitClone).toHaveBeenCalledWith("https://github.com/example/repo", "/home/workspace/repo");
    expect(createPty).toHaveBeenCalledWith(expect.objectContaining({
      envs: expect.objectContaining({
        TERM: "xterm-256color",
      }),
    }));
    expect(createPty.mock.calls[0]?.[0]).not.toHaveProperty("cwd");
    expect(fakePty.sendInput).toHaveBeenNthCalledWith(1, "cd '/home/workspace/repo'\r");
    expect(fakePty.sendInput).toHaveBeenNthCalledWith(2, "pwd\r");
  });

  it("reuses one persisted Daytona sandbox across projects for the same user", async () => {
    const fakePty = pty();
    const gitStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("not a git repository"))
      .mockResolvedValueOnce({ currentBranch: "main" })
      .mockRejectedValueOnce(new Error("not a git repository"))
      .mockResolvedValueOnce({ currentBranch: "main" });
    const gitClone = vi.fn().mockResolvedValue(undefined);
    const sharedSandbox = {
      id: "sandbox-user-1",
      state: "started",
      process: { createPty, executeCommand },
      git: { status: gitStatus, clone: gitClone },
    };
    createPty.mockResolvedValue(fakePty);
    daytonaGet.mockRejectedValueOnce(new DaytonaNotFoundError("not found"));
    daytonaCreate.mockResolvedValue(sharedSandbox);

    const first = await ensureRemoteProjectRepository({
      context,
      projectId: "hp-1",
      path: "/home/workspace/repo-one",
      githubUrl: "https://github.com/example/repo-one",
    });
    const second = await ensureRemoteProjectRepository({
      context,
      projectId: "hp-2",
      path: "/home/workspace/repo-two",
      githubUrl: "https://github.com/example/repo-two",
    });
    await spawnRemotePty({
      context,
      projectId: "hp-2",
      taskId: "ht-2",
      cwd: "/home/workspace/repo-two",
      command: "pwd",
    });

    expect(first.sandboxId).toBe("sandbox-user-1");
    expect(second.sandboxId).toBe("sandbox-user-1");
    expect(daytonaCreate).toHaveBeenCalledTimes(1);
    expect(daytonaCreate.mock.calls[0]?.[0].snapshot).toBe("mission-control-cloud-agents");
    expect(daytonaCreate.mock.calls[0]?.[0].autoStopInterval).toBe(15);
    expect(daytonaCreate.mock.calls[0]?.[0].labels).toEqual(expect.objectContaining({
      app: "mission-control",
      runtime: "web-daytona",
      owner: "user",
    }));
    expect(daytonaCreate.mock.calls[0]?.[0].labels).not.toHaveProperty("projectId");
    expect(daytonaCreate.mock.calls[0]?.[0].labels).not.toHaveProperty("taskId");
    expect(gitClone).toHaveBeenCalledWith("https://github.com/example/repo-one", "/home/workspace/repo-one");
    expect(gitClone).toHaveBeenCalledWith("https://github.com/example/repo-two", "/home/workspace/repo-two");
    expect(createPty).toHaveBeenCalledTimes(1);
  });

  it("allows the Daytona snapshot to be overridden per environment", async () => {
    process.env.DAYTONA_SNAPSHOT = "mission-control-cloud-agents-staging";
    const sharedSandbox = {
      id: "sandbox-user-1",
      state: "started",
      process: { createPty, executeCommand },
      git: {
        status: vi.fn().mockResolvedValue({ currentBranch: "main" }),
        clone: vi.fn(),
      },
    };
    daytonaGet.mockRejectedValueOnce(new DaytonaNotFoundError("not found"));
    daytonaCreate.mockResolvedValue(sharedSandbox);

    await ensureRemoteProjectRepository({
      context,
      projectId: "hp-1",
      path: "/home/workspace/repo",
      githubUrl: "https://github.com/example/repo",
    });

    expect(daytonaCreate.mock.calls[0]?.[0].snapshot).toBe("mission-control-cloud-agents-staging");
  });

  it("re-fetches the shared sandbox when concurrent creation wins first", async () => {
    const sharedSandbox = {
      id: "sandbox-user-1",
      state: "started",
      process: { createPty, executeCommand },
      git: {
        status: vi.fn().mockResolvedValue({ currentBranch: "main" }),
        clone: vi.fn(),
      },
    };
    daytonaGet
      .mockRejectedValueOnce(new DaytonaNotFoundError("not found"))
      .mockResolvedValueOnce(sharedSandbox);
    daytonaCreate.mockRejectedValueOnce({ status: 409 });

    const result = await ensureRemoteProjectRepository({
      context,
      projectId: "hp-1",
      path: "/home/workspace/repo",
      githubUrl: "https://github.com/example/repo",
    });

    expect(result.sandboxId).toBe("sandbox-user-1");
    expect(daytonaCreate).toHaveBeenCalledTimes(1);
    expect(daytonaGet).toHaveBeenCalledTimes(2);
  });

  it("does not delete the shared user sandbox when PTY shell startup fails", async () => {
    const error = new Error("PTY shell /usr/bin/zsh is not available");
    createPty.mockRejectedValue(error);
    daytonaGet.mockResolvedValue({
      id: "sandbox-user-1",
      state: "started",
      process: { createPty, executeCommand },
    });

    await expect(spawnRemotePty({
      context,
      projectId: "hp-1",
      taskId: "ht-1",
      cwd: "/home/workspace/project",
      command: "pwd",
    })).rejects.toThrow(error.message);

    expect(daytonaDelete).not.toHaveBeenCalled();
    expect(logHostedEvent).toHaveBeenCalledWith(
      "remote_pty.shell_failure",
      expect.objectContaining({
        projectId: "hp-1",
        taskId: "ht-1",
      }),
      "warn",
    );
  });

  it("kills active PTYs for a project without deleting the shared sandbox", async () => {
    const fakePty = pty();
    createPty.mockResolvedValue(fakePty);
    daytonaGet.mockResolvedValue({
      id: "sandbox-user-1",
      state: "started",
      process: { createPty, executeCommand },
    });

    const { ptyId } = await spawnRemotePty({
      context,
      projectId: "hp-1",
      cwd: "/home/workspace/project",
      command: "pwd",
    });

    await killRemotePtysForProject(context, "hp-1");

    expect(fakePty.kill).toHaveBeenCalled();
    expect(recordHostedRuntimeEnd).toHaveBeenCalledWith(ptyId);
    expect(daytonaDelete).not.toHaveBeenCalled();
    expect(countActiveRemotePtys(context)).toBe(0);
  });

  it("clamps undersized Daytona PTY dimensions before spawn and resize", async () => {
    const fakePty = pty();
    createPty.mockResolvedValue(fakePty);
    daytonaGet.mockResolvedValue({
      id: "sandbox-1",
      state: "started",
      process: { createPty, executeCommand },
    });
    hostedComputeLimitStatus.mockResolvedValue({
      allowed: true,
      tier: "mission_control_cloud",
      limitSeconds: 3600,
      usedSeconds: 120,
      windowDays: 30,
      currentPeriodStartsAt: "2026-05-01T00:00:00.000Z",
    });

    const { ptyId } = await spawnRemotePty({
      context,
      projectId: "hp-small-terminal",
      cwd: "/home/workspace/project",
      command: "pwd",
      cols: 4,
      rows: 2,
    });

    expect(createPty).toHaveBeenCalledWith(expect.objectContaining({
      cols: 10,
      rows: 10,
    }));

    await resizeRemotePty(context, ptyId, 1, 3);

    expect(fakePty.resize).toHaveBeenCalledWith(10, 10);
  });
});
