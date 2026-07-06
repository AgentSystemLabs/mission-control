import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetClaudeUsageLimitsCache,
  _setSharedLimitsFileForTests,
  _setTokenReaderForTests,
  getClaudeUsageLimits,
} from "../claude-usage-limits";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let tmpDir: string;
let sharedFile: string;

function writeSharedFile(body: unknown, ageMs = 0): void {
  fs.writeFileSync(sharedFile, JSON.stringify(body), "utf8");
  if (ageMs > 0) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(sharedFile, t, t);
  }
}

describe("claude usage limits service", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-limits-"));
    sharedFile = path.join(tmpDir, "limits.json");
    _resetClaudeUsageLimitsCache();
    _setSharedLimitsFileForTests(sharedFile);
    _setTokenReaderForTests(() => "test-token");
  });

  afterEach(() => {
    _setTokenReaderForTests(null);
    _setSharedLimitsFileForTests(null);
    _resetClaudeUsageLimitsCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  describe("shared statusline-tap file", () => {
    it("serves a fresh shared file without touching the endpoint", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      writeSharedFile({
        five_hour: { utilization: 19, resets_at: "2026-07-04T11:50:00Z" },
        seven_day: { utilization: 37, resets_at: "2026-07-06T16:00:00Z" },
        source: "statusline",
      });

      const result = await getClaudeUsageLimits();
      expect(result.status).toBe("ok");
      expect(result.session).toEqual({ utilization: 19, resetsAt: "2026-07-04T11:50:00Z" });
      expect(result.weekly?.utilization).toBe(37);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to the endpoint when the shared file is stale", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ five_hour: { utilization: 50, resets_at: null } }));
      vi.stubGlobal("fetch", fetchMock);
      writeSharedFile(
        { five_hour: { utilization: 19, resets_at: null }, source: "statusline" },
        11 * 60_000,
      );

      const result = await getClaudeUsageLimits();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.session?.utilization).toBe(50);
    });

    it("ignores a shared file with no usable windows", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ five_hour: { utilization: 5, resets_at: null } }));
      vi.stubGlobal("fetch", fetchMock);
      writeSharedFile({ five_hour: null, seven_day: null, source: "statusline" });

      const result = await getClaudeUsageLimits();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.session?.utilization).toBe(5);
    });

    it("recovers from a rate-limit backoff as soon as a fresh tap snapshot lands", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
      const limited = await getClaudeUsageLimits();
      expect(limited.status).toBe("rate_limited");

      writeSharedFile({ five_hour: { utilization: 42, resets_at: null }, source: "statusline" });

      const recovered = await getClaudeUsageLimits();
      expect(recovered.status).toBe("ok");
      expect(recovered.session?.utilization).toBe(42);
    });

    it("publishes an endpoint success back to the shared file", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            five_hour: { utilization: 48, resets_at: "2026-07-10T06:49:00Z" },
            seven_day: { utilization: 36, resets_at: null },
          }),
        ),
      );

      await getClaudeUsageLimits();

      const written = JSON.parse(fs.readFileSync(sharedFile, "utf8"));
      expect(written.five_hour).toEqual({ utilization: 48, resets_at: "2026-07-10T06:49:00Z" });
      expect(written.seven_day.utilization).toBe(36);
      expect(written.source).toBe("endpoint");
    });
  });

  describe("rate-limit backoff", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("doubles the retry interval on consecutive 429s", async () => {
      const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
      vi.stubGlobal("fetch", fetchMock);

      await getClaudeUsageLimits(); // 429 #1 → wait 60s
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(61_000);
      await getClaudeUsageLimits(); // 429 #2 → wait 120s
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(61_000); // only 61s — still backing off
      await getClaudeUsageLimits();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(60_000); // 121s total since #2
      await getClaudeUsageLimits(); // 429 #3
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("resets the backoff after a success", async () => {
      const statuses = [429, 429, 200, 429, 429];
      let call = 0;
      const fetchMock = vi.fn(async () => {
        const status = statuses[Math.min(call++, statuses.length - 1)];
        return status === 200
          ? jsonResponse({ five_hour: { utilization: 1, resets_at: null } })
          : new Response("", { status: 429 });
      });
      vi.stubGlobal("fetch", fetchMock);

      await getClaudeUsageLimits(); // 429 #1
      await vi.advanceTimersByTimeAsync(61_000);
      await getClaudeUsageLimits(); // 429 #2 → backoff now 120s
      await vi.advanceTimersByTimeAsync(121_000);
      await getClaudeUsageLimits(); // success → backoff reset
      fs.rmSync(sharedFile, { force: true }); // drop the published snapshot
      await vi.advanceTimersByTimeAsync(181_000); // past SUCCESS_TTL
      await getClaudeUsageLimits(); // 429 again → back to 60s, not 240s
      expect(fetchMock).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(61_000);
      await getClaudeUsageLimits();
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it("keeps serving the last good snapshot while rate limited", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 33, resets_at: null } }))
        .mockResolvedValue(new Response("", { status: 429 }));
      vi.stubGlobal("fetch", fetchMock);

      const first = await getClaudeUsageLimits();
      expect(first.session?.utilization).toBe(33);

      fs.rmSync(sharedFile, { force: true }); // drop the published snapshot
      await vi.advanceTimersByTimeAsync(181_000); // past SUCCESS_TTL
      const second = await getClaudeUsageLimits(); // 429 → serve last good
      expect(second.status).toBe("ok");
      expect(second.session?.utilization).toBe(33);
    });
  });
});
