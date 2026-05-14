import { afterEach, describe, expect, it, vi } from "vitest";

const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
  }
});

describe("browser runtime auth", () => {
  it("does not fall back to cloud runtime in an Electron window with a missing bridge", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "http://127.0.0.1:5173", protocol: "http:" },
        navigator: { userAgent: "Mozilla/5.0 MissionControl Electron/41.0.0" },
      },
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { getRuntime } = await import("../runtime");

    expect(getRuntime()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose the cloud runtime in a local browser tab after mode is known", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "http://localhost:5173", protocol: "http:" } },
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { getRuntime, setRuntimeMode } = await import("../runtime");

    expect(getRuntime()?.hostKind).toBe("cloud");
    setRuntimeMode(false);
    expect(getRuntime()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches the bootstrapped local API token to runtime PTY requests", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "http://localhost:5173" } },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "local-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ptyId: "pty-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getRuntime } = await import("../runtime");
    const runtime = getRuntime();
    expect(runtime).not.toBeNull();

    await expect(
      runtime!.pty.spawn({
        taskId: "task-1",
        projectId: "project-1",
        command: "claude",
      }),
    ).resolves.toEqual({ ptyId: "pty-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBeNull();
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer local-token");
  });

  it("refreshes a stale runtime token and retries once after a 401", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "http://localhost:5173" } },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "stale-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "fresh-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ptyId: "pty-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getRuntime } = await import("../runtime");
    const runtime = getRuntime();
    expect(runtime).not.toBeNull();

    await expect(
      runtime!.pty.spawn({
        taskId: "task-1",
        projectId: "project-1",
        command: "claude",
      }),
    ).resolves.toEqual({ ptyId: "pty-1" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer stale-token");
    expect(
      new Headers((fetchMock.mock.calls[3]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer fresh-token");
  });
});
