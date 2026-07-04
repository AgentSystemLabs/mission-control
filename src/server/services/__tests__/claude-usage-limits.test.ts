import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetClaudeUsageLimitsCache,
  _setTokenReaderForTests,
  getClaudeUsageLimits,
} from "../claude-usage-limits";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("claude usage limits service", () => {
  beforeEach(() => {
    _resetClaudeUsageLimitsCache();
    _setTokenReaderForTests(() => "test-token");
  });

  afterEach(() => {
    _setTokenReaderForTests(null);
    _resetClaudeUsageLimitsCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("maps five_hour/seven_day/seven_day_opus into session/weekly/weeklyOpus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          five_hour: { utilization: 48, resets_at: "2026-07-10T06:49:00Z" },
          seven_day: { utilization: 36, resets_at: "2026-07-13T15:59:00Z" },
          seven_day_opus: { utilization: 12, resets_at: "2026-07-13T15:59:00Z" },
        }),
      ),
    );

    const result = await getClaudeUsageLimits();
    expect(result.status).toBe("ok");
    expect(result.session).toEqual({ utilization: 48, resetsAt: "2026-07-10T06:49:00Z" });
    expect(result.weekly).toEqual({ utilization: 36, resetsAt: "2026-07-13T15:59:00Z" });
    expect(result.weeklyOpus?.utilization).toBe(12);
  });

  it("sends the OAuth bearer token and beta header", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ five_hour: { utilization: 5, resets_at: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await getClaudeUsageLimits();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/oauth/usage");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  });

  it("returns unauthenticated without fetching when there is no token", async () => {
    _setTokenReaderForTests(() => null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getClaudeUsageLimits();
    expect(result.status).toBe("unauthenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 401 to unauthenticated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const result = await getClaudeUsageLimits();
    expect(result.status).toBe("unauthenticated");
  });

  it("maps a 429 to rate_limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    const result = await getClaudeUsageLimits();
    expect(result.status).toBe("rate_limited");
  });

  it("treats malformed JSON as an error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    const result = await getClaudeUsageLimits();
    expect(result.status).toBe("error");
  });

  it("caches within the TTL so repeated calls hit the API once", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ five_hour: { utilization: 10, resets_at: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await getClaudeUsageLimits();
    await getClaudeUsageLimits();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent calls into a single in-flight request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ five_hour: { utilization: 20, resets_at: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([getClaudeUsageLimits(), getClaudeUsageLimits(), getClaudeUsageLimits()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
