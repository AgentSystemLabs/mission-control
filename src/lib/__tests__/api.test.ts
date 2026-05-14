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

describe("api client auth", () => {
  it("preserves application error codes from JSON error envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "A project for this Git repository already exists.",
            code: "duplicate_project",
            details: { field: "repoUrl" },
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const { api, ApiError } = await import("../api");

    await expect(api.listProjects()).rejects.toMatchObject({
      name: "ApiError",
      message: "A project for this Git repository already exists.",
      status: 409,
      code: "duplicate_project",
      details: { field: "repoUrl" },
    });
    await expect(api.listProjects()).rejects.toBeInstanceOf(ApiError);
  });

  it("does not expose non-JSON response bodies in ApiError messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("Failed query: insert into projects secret params", {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const { api } = await import("../api");

    await expect(api.listProjects()).rejects.toMatchObject({
      name: "ApiError",
      message: "Request failed",
      status: 500,
    });
    await expect(api.listProjects()).rejects.not.toMatchObject({
      message: expect.stringContaining("Failed query"),
    });
  });

  it("retries a local request when the first 401 bootstraps the Electron API token", async () => {
    const getApiToken = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("local-token");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { electronAPI: { getApiToken } },
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../api");

    await expect(api.listProjects()).resolves.toEqual({ projects: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getApiToken).toHaveBeenCalledTimes(2);
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

  it("refreshes the cached local token before retrying an automatic 401", async () => {
    const getApiToken = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { electronAPI: { getApiToken } },
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../api");

    await expect(api.listProjects()).resolves.toEqual({ projects: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer stale-token");
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer fresh-token");
  });

  it("does not attach local API auth when the Electron bridge is missing", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "http://127.0.0.1:5173", protocol: "http:" },
        navigator: { userAgent: "Mozilla/5.0 MissionControl Electron/41.0.0" },
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("../api");

    await expect(api.listProjects()).resolves.toEqual({ projects: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/runtime/client-token");
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).get(
        "authorization",
      ),
    ).toBeNull();
  });
});
