import { describe, expect, it, beforeEach, vi } from "vitest";
import type { HostedAuthContext } from "../../hosted-auth-context";
import { ValidationError } from "../../errors";

const getHostedAuthContext = vi.hoisted(() => vi.fn());
const readEntitlements = vi.hoisted(() => vi.fn());
const getHostedProject = vi.hoisted(() => vi.fn());
const getHostedTask = vi.hoisted(() => vi.fn());
const issueHostedHookToken = vi.hoisted(() => vi.fn());
const revokeHostedHookTokens = vi.hoisted(() => vi.fn());
const getHostedHookApiUrl = vi.hoisted(() => vi.fn());
const remotePtySpawnRateLimit = vi.hoisted(() => vi.fn());
const enforceHostedComputeLimit = vi.hoisted(() => vi.fn());
const spawnRemotePty = vi.hoisted(() => vi.fn());
const countActiveRemotePtys = vi.hoisted(() => vi.fn());
const maxActiveRemotePtysPerScope = vi.hoisted(() => vi.fn());
const maxRetainedRemotePtyOutputBytes = vi.hoisted(() => vi.fn());
const remotePtyScopeKey = vi.hoisted(() => vi.fn());
const remoteRuntimeDisabled = vi.hoisted(() => vi.fn());
const consumeRemotePtyTicket = vi.hoisted(() => vi.fn());
const issueRemotePtyTicket = vi.hoisted(() => vi.fn());
const subscribeRemotePty = vi.hoisted(() => vi.fn());
const logHostedEvent = vi.hoisted(() => vi.fn());
const incrementHostedCounter = vi.hoisted(() => vi.fn());

vi.mock("../../hosted-auth-context", () => ({
  getHostedAuthContext,
}));

vi.mock("../../services/entitlements", () => ({
  readEntitlements,
}));

vi.mock("../../services/hosted-projects", () => ({
  getHostedProject,
  getHostedTask,
}));

vi.mock("../../services/hosted-hook-tokens", () => ({
  issueHostedHookToken,
  revokeHostedHookTokens,
}));

vi.mock("../../services/remote-agent-hooks", () => ({
  getHostedHookApiUrl,
}));

vi.mock("../../services/rate-limits", () => ({
  remotePtySpawnRateLimit,
  remotePtyWriteRateLimit: vi.fn(() => ({ ok: true })),
}));

vi.mock("../../services/hosted-plan-limits", () => ({
  enforceHostedComputeLimit,
}));

vi.mock("../../services/hosted-logs", () => ({
  logHostedEvent,
}));

vi.mock("../../services/hosted-metrics", () => ({
  incrementHostedCounter,
}));

vi.mock("../../services/daytona-remote-pty", () => ({
  consumeRemotePtyTicket,
  countActiveRemotePtys,
  issueRemotePtyTicket,
  killRemotePty: vi.fn(),
  maxActiveRemotePtysPerScope,
  maxRetainedRemotePtyOutputBytes,
  remotePtyScopeKey,
  remoteRuntimeDisabled,
  replayRemotePty: vi.fn(),
  resizeRemotePty: vi.fn(),
  spawnRemotePty,
  subscribeRemotePty,
  writeRemotePty: vi.fn(),
}));

const { spawn, stream, ticket } = await import("../remote-pty.controller");

const context: HostedAuthContext = {
  sessionId: "hs-1",
  academyUserId: "academy-user-1",
  userId: "user-1",
  email: "user@example.com",
  organizationId: null,
};

function spawnRequest(body: Record<string, unknown>) {
  return new Request("http://127.0.0.1/api/remote-pty", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function request(url = "http://127.0.0.1/api/remote-pty/pty-1/events?ticket=ticket-1") {
  return new Request(url);
}

describe("remote PTY controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHostedAuthContext.mockResolvedValue(context);
    readEntitlements.mockResolvedValue({
      hosted: { enabled: true, userId: "user-1", organizationId: null },
      remoteRuntime: {
        allowed: true,
        reason: null,
        plan: "paid",
        trialEndsAt: null,
      },
    });
    getHostedProject.mockResolvedValue({
      id: "hp-1",
      path: "/home/daytona/remote-repo",
    });
    getHostedTask.mockResolvedValue({
      id: "ht-1",
      projectId: "hp-1",
    });
    issueHostedHookToken.mockResolvedValue("hook-token");
    revokeHostedHookTokens.mockResolvedValue(undefined);
    getHostedHookApiUrl.mockReturnValue("https://mission-control.example.com/api/hooks");
    remotePtySpawnRateLimit.mockReturnValue({ ok: true });
    enforceHostedComputeLimit.mockResolvedValue({
      limitSeconds: 3600,
      usedSeconds: 120,
      windowDays: 30,
    });
    spawnRemotePty.mockResolvedValue({ ptyId: "pty-1" });
    countActiveRemotePtys.mockReturnValue(0);
    maxActiveRemotePtysPerScope.mockReturnValue(5);
    maxRetainedRemotePtyOutputBytes.mockReturnValue(1_000_000);
    remotePtyScopeKey.mockReturnValue("user:user-1");
    remoteRuntimeDisabled.mockReturnValue(false);
    consumeRemotePtyTicket.mockReturnValue(false);
    issueRemotePtyTicket.mockReturnValue({ ticket: "ticket-1", expiresAt: Date.now() + 30_000 });
    subscribeRemotePty.mockReturnValue(null);
    logHostedEvent.mockReset();
    incrementHostedCounter.mockReset();
  });

  it("denies remote runtime when Academy entitlement is inactive", async () => {
    readEntitlements.mockResolvedValueOnce({
      hosted: { enabled: true, userId: "user-1", organizationId: null },
      remoteRuntime: {
        allowed: false,
        reason: "subscription-required",
        plan: "none",
        trialEndsAt: null,
      },
    });

    const response = await spawn(spawnRequest({
      projectId: "hp-1",
      cwd: "/home/daytona/remote-repo",
      command: "pwd",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "subscription-required" });
    expect(spawnRemotePty).not.toHaveBeenCalled();
  });

  it("starts an agent task with mocked Daytona and hosted hook env", async () => {
    const response = await spawn(spawnRequest({
      taskId: "ht-1",
      cwd: "/tmp/client-supplied",
      command: "claude",
      agent: "claude-code",
      cols: 120,
      rows: 40,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ptyId: "pty-1" });
    expect(issueHostedHookToken).toHaveBeenCalledWith(context, "ht-1");
    expect(spawnRemotePty).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "ht-1",
      projectId: "hp-1",
      cwd: "/home/daytona/remote-repo",
      hookEnv: {
        apiUrl: "https://mission-control.example.com/api/hooks",
        token: "hook-token",
      },
      context,
    }));
  });

  it("starts an agent task without hooks when no public callback URL is configured", async () => {
    getHostedHookApiUrl.mockReturnValueOnce(null);

    const response = await spawn(spawnRequest({
      taskId: "ht-1",
      cwd: "/tmp/client-supplied",
      command: "claude",
      agent: "claude-code",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ptyId: "pty-1" });
    expect(issueHostedHookToken).not.toHaveBeenCalled();
    expect(spawnRemotePty).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "ht-1",
      hookEnv: null,
      context,
    }));
    expect(logHostedEvent).toHaveBeenCalledWith(
      "remote_pty.hooks_skipped",
      expect.objectContaining({
        projectId: "hp-1",
        taskId: "ht-1",
        reason: "missing_public_url",
      }),
      "warn",
    );
  });

  it("accepts transient undersized terminal dimensions", async () => {
    const response = await spawn(spawnRequest({
      projectId: "hp-1",
      cwd: "/home/daytona/remote-repo",
      command: "pwd",
      cols: 8,
      rows: 4,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ptyId: "pty-1" });
    expect(spawnRemotePty).toHaveBeenCalledWith(expect.objectContaining({
      cols: 8,
      rows: 4,
    }));
  });

  it("denies new Daytona starts after the hosted compute limit is reached", async () => {
    enforceHostedComputeLimit.mockRejectedValueOnce(
      new ValidationError("compute limit reached for the last 30 days"),
    );

    const response = await spawn(spawnRequest({
      projectId: "hp-1",
      cwd: "/home/daytona/remote-repo",
      command: "pwd",
    }));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error:
        "compute limit reached for the last 30 days. Open Academy billing to upgrade or wait for the usage window to reset.",
    });
    expect(spawnRemotePty).not.toHaveBeenCalled();
  });

  it("returns a hosted runtime configuration error when Daytona rejects credentials", async () => {
    spawnRemotePty.mockRejectedValueOnce(new Error("Invalid credentials"));

    const response = await spawn(spawnRequest({
      projectId: "hp-1",
      cwd: "/home/daytona/remote-repo",
      command: "pwd",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted remote runtime is misconfigured. Check DAYTONA_API_KEY and DAYTONA_API_URL.",
    });
    expect(logHostedEvent).toHaveBeenCalledWith(
      "remote_pty.runtime_configuration_error",
      expect.objectContaining({
        projectId: "hp-1",
        taskId: null,
        error: "Invalid credentials",
      }),
      "error",
    );
  });

  it("returns a hosted runtime configuration error when the sandbox shell is missing", async () => {
    spawnRemotePty.mockRejectedValueOnce(
      new Error("Failed to connect to PTY session: failed to start PTY session: pty.StartWithSize: fork/exec /usr/bin/zsh: no such file or directory"),
    );

    const response = await spawn(spawnRequest({
      projectId: "hp-1",
      cwd: "/home/daytona/remote-repo",
      command: "pwd",
    }));

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toContain(
      "Hosted remote runtime could not start its shell. Check DAYTONA_PTY_SHELL for the sandbox image.",
    );
    expect(body.error).toContain("fork/exec /usr/bin/zsh");
  });

  it("issues remote stream tickets for the authenticated hosted context", async () => {
    const response = await ticket("pty-1", request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ticket: "ticket-1",
      expiresAt: expect.any(Number),
    });
    expect(issueRemotePtyTicket).toHaveBeenCalledWith(context, "pty-1");
  });

  it("consumes remote stream tickets with the authenticated hosted context", async () => {
    consumeRemotePtyTicket.mockReturnValueOnce(true);
    const req = request();
    const response = await stream("pty-1", req, new URL(req.url));

    expect(response.status).toBe(200);
    expect(consumeRemotePtyTicket).toHaveBeenCalledWith(context, "pty-1", "ticket-1");
    await response.body?.cancel();
  });

  it("rejects remote stream tickets that do not match the authenticated context", async () => {
    consumeRemotePtyTicket.mockReturnValueOnce(false);
    const req = request();
    const response = await stream("pty-1", req, new URL(req.url));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
