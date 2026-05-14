import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runtime API error handling", () => {
  it("does not expose the local API token over HTTP", async () => {
    vi.doMock("../cloud/auth", () => ({
      isCloudMode: () => false,
      requireAppAuth: vi.fn(),
      requireCloudUser: vi.fn(),
    }));

    const { handleRuntimeApiRequest } = await import("../runtime/api");
    const response = await handleRuntimeApiRequest(
      new Request("http://localhost/api/runtime/client-token", {
        method: "GET",
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ token: null });
  });

  it("masks unexpected runtime failures", async () => {
    vi.doMock("../cloud/auth", () => ({
      isCloudMode: () => true,
      requireAppAuth: async () => ({ ok: true, user: null }),
      requireCloudUser: async () => ({ ok: true, user: { id: "user-1" } }),
    }));
    vi.doMock("../services/tasks", () => ({
      getTask: async () => ({ id: "task-1", projectId: "project-1" }),
    }));
    vi.doMock("../runtime/daytona", () => ({
      killRuntimePty: vi.fn(),
      listRuntimeFiles: vi.fn(),
      readRuntimeFile: vi.fn(),
      replayRuntimePty: vi.fn(),
      resizeRuntimePty: vi.fn(),
      spawnRuntimePty: vi.fn(async () => {
        throw new Error("secret sandbox provider token");
      }),
      subscribeRuntimeEvents: vi.fn(() => () => undefined),
      getRuntimePtyProjectId: vi.fn(),
      unwatchRuntimeFile: vi.fn(),
      watchRuntimeFile: vi.fn(),
      writeRuntimeFile: vi.fn(),
      writeRuntimePty: vi.fn(),
    }));

    const { handleRuntimeApiRequest } = await import("../runtime/api");
    const response = await handleRuntimeApiRequest(
      new Request("http://localhost/api/runtime/pty/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: "task-1",
          projectId: "project-1",
          command: "bash",
        }),
      }),
    );
    const body = (await response?.json()) as Record<string, unknown>;

    expect(response?.status).toBe(500);
    expect(body).toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
    expect(JSON.stringify(body)).not.toContain("secret sandbox");
  });

  it("rejects cloud PTY writes when the supplied project does not match the PTY", async () => {
    vi.doMock("../cloud/auth", () => ({
      isCloudMode: () => true,
      requireAppAuth: async () => ({ ok: true, user: { id: "user-1" } }),
      requireCloudUser: async () => ({ ok: true, user: { id: "user-1" } }),
    }));
    const writeRuntimePty = vi.fn();
    vi.doMock("../runtime/daytona", () => ({
      killRuntimePty: vi.fn(),
      listRuntimeFiles: vi.fn(),
      readRuntimeFile: vi.fn(),
      replayRuntimePty: vi.fn(),
      resizeRuntimePty: vi.fn(),
      spawnRuntimePty: vi.fn(),
      subscribeRuntimeEvents: vi.fn(() => () => undefined),
      getRuntimePtyProjectId: vi.fn(() => "project-a"),
      getRuntimeWorkspacePath: vi.fn(),
      killRuntimeLaunchProcesses: vi.fn(),
      unwatchRuntimeFile: vi.fn(),
      watchRuntimeFile: vi.fn(),
      writeRuntimeFile: vi.fn(),
      writeRuntimePty,
    }));

    const { handleRuntimeApiRequest } = await import("../runtime/api");
    const response = await handleRuntimeApiRequest(
      new Request("http://localhost/api/runtime/pty/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ptyId: "pty-1",
          projectId: "project-b",
          data: "hello",
        }),
      }),
    );

    expect(response?.status).toBe(403);
    expect(writeRuntimePty).not.toHaveBeenCalled();
  });

  it("allows runtime PTY spawn for project user terminals", async () => {
    vi.doMock("../cloud/auth", () => ({
      isCloudMode: () => true,
      requireAppAuth: async () => ({ ok: true, user: null }),
      requireCloudUser: async () => ({ ok: true, user: { id: "user-1" } }),
    }));
    vi.doMock("../services/tasks", () => ({
      getTask: async () => null,
    }));
    vi.doMock("../services/user-terminals", () => ({
      getUserTerminalProjectId: async () => "project-1",
    }));
    const spawnRuntimePty = vi.fn(async () => ({ ptyId: "cloud-pty-1" }));
    vi.doMock("../runtime/daytona", () => ({
      killRuntimePty: vi.fn(),
      listRuntimeFiles: vi.fn(),
      readRuntimeFile: vi.fn(),
      replayRuntimePty: vi.fn(),
      resizeRuntimePty: vi.fn(),
      spawnRuntimePty,
      subscribeRuntimeEvents: vi.fn(() => () => undefined),
      getRuntimePtyProjectId: vi.fn(),
      getRuntimeWorkspacePath: vi.fn(),
      killRuntimeLaunchProcesses: vi.fn(),
      unwatchRuntimeFile: vi.fn(),
      watchRuntimeFile: vi.fn(),
      writeRuntimeFile: vi.fn(),
      writeRuntimePty: vi.fn(),
    }));

    const { handleRuntimeApiRequest } = await import("../runtime/api");
    const response = await handleRuntimeApiRequest(
      new Request("http://localhost/api/runtime/pty/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: "ut-1",
          projectId: "project-1",
          command: "",
        }),
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ ptyId: "cloud-pty-1" });
    expect(spawnRuntimePty).toHaveBeenCalled();
  });
});
