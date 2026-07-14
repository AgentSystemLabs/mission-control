import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProviderUsage,
  _resetCodexUsageCache,
  _resetCursorUsageCache,
  _resetProviderUsageCacheForTests,
  _setCodexCredsReaderForTests,
  _setCursorSessionReaderForTests,
} from "../provider-usage";
import {
  _resetClaudeUsageLimitsCache,
  _setSharedLimitsFileForTests,
  _setTokenReaderForTests,
} from "../claude-usage-limits";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("getProviderUsage aggregator", () => {
  let tmpDir: string;
  let sharedFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-provider-usage-"));
    sharedFile = path.join(tmpDir, "limits.json");
    _resetClaudeUsageLimitsCache();
    _resetCodexUsageCache();
    _resetCursorUsageCache();
    _resetProviderUsageCacheForTests();
    _setSharedLimitsFileForTests(sharedFile);
    _setTokenReaderForTests(() => null);
    _setCodexCredsReaderForTests(() => null);
    _setCursorSessionReaderForTests(() => null);
  });

  afterEach(() => {
    _setTokenReaderForTests(null);
    _setCodexCredsReaderForTests(null);
    _setCursorSessionReaderForTests(null);
    _setSharedLimitsFileForTests(null);
    _resetClaudeUsageLimitsCache();
    _resetCodexUsageCache();
    _resetCursorUsageCache();
    _resetProviderUsageCacheForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns multi-provider payload with status per provider (no network when unauthenticated)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProviderUsage(["claude", "codex", "cursor"]);
    expect(result.providers).toHaveLength(3);
    expect(result.providers.map((p) => p.id)).toEqual(["claude", "codex", "cursor"]);
    for (const p of result.providers) {
      expect(p.status).toBe("unauthenticated");
      expect(p.windows).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(typeof result.fetchedAt).toBe("number");
  });

  it("aggregates live normalize paths for Claude + Codex fixtures", async () => {
    _setTokenReaderForTests(() => "claude-token");
    _setCodexCredsReaderForTests(() => ({ accessToken: "codex-token", accountId: "acc-1" }));
    _setCursorSessionReaderForTests(() => null);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("anthropic.com")) {
          return jsonResponse({
            five_hour: { utilization: 48, resets_at: "2026-07-10T06:49:00Z" },
            seven_day: { utilization: 36, resets_at: "2026-07-13T15:59:00Z" },
          });
        }
        if (String(url).includes("wham/usage")) {
          return jsonResponse({
            rate_limit: {
              primary_window: {
                used_percent: 22,
                reset_at: 1_720_000_000,
                limit_window_seconds: 18_000,
              },
              secondary_window: {
                used_percent: 8,
                reset_at: 1_720_500_000,
                limit_window_seconds: 604_800,
              },
            },
          });
        }
        return new Response("", { status: 404 });
      }),
    );

    const result = await getProviderUsage(["claude", "codex", "cursor"]);
    const claude = result.providers.find((p) => p.id === "claude")!;
    const codex = result.providers.find((p) => p.id === "codex")!;
    const cursor = result.providers.find((p) => p.id === "cursor")!;

    expect(claude.status).toBe("ok");
    expect(claude.windows.find((w) => w.id === "session")?.utilization).toBe(48);
    expect(codex.status).toBe("ok");
    expect(codex.windows.find((w) => w.id === "session")?.utilization).toBe(22);
    expect(cursor.status).toBe("unauthenticated");
  });

  it("marks token/oauth providers unauthenticated without credentials (no network)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Clear ambient env keys and force empty CodexBar config so adapters skip HTTP.
    const cleared = [
      "OPENROUTER_API_KEY",
      "OPENAI_API_KEY",
      "OPENAI_ADMIN_KEY",
      "DEEPSEEK_API_KEY",
      "POE_API_KEY",
      "ELEVENLABS_API_KEY",
      "XI_API_KEY",
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const k of cleared) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    const creds = await import("../provider-usage/credentials");
    creds._resetCodexBarConfigCache();
    const loadSpy = vi.spyOn(creds, "loadCodexBarConfig").mockReturnValue(null);
    const jsonHomeSpy = vi.spyOn(creds, "readJsonHome").mockReturnValue(null);
    const textHomeSpy = vi.spyOn(creds, "readTextFileHome").mockReturnValue(null);
    try {
      const result = await getProviderUsage(["openrouter", "gemini", "deepseek"]);
      expect(result.providers).toHaveLength(3);
      for (const p of result.providers) {
        expect(p.status).toBe("unauthenticated");
        expect(p.status).not.toBe("unavailable");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      loadSpy.mockRestore();
      jsonHomeSpy.mockRestore();
      textHomeSpy.mockRestore();
      creds._resetCodexBarConfigCache();
      for (const k of cleared) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });

  it("drives Cursor normalize path via usage-summary body", async () => {
    _setCursorSessionReaderForTests(() => ({
      accessToken: "tok",
      cookieHeader: "WorkosCursorSessionToken=user%3A%3Atok",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          billingCycleEnd: "2026-08-01T00:00:00.000Z",
          individualUsage: {
            plan: { totalPercentUsed: 55, autoPercentUsed: 30, apiPercentUsed: 10 },
          },
        }),
      ),
    );

    const result = await getProviderUsage(["cursor"]);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.status).toBe("ok");
    expect(result.providers[0]!.windows[0]).toMatchObject({ id: "plan", utilization: 55 });
  });

  it("caches a generic adapter within TTL (a second aggregate call does not re-invoke it)", async () => {
    // openrouter routes through the generic fetchOne cache (unlike claude/codex/
    // cursor, which are passed straight through to their own caches).
    const prevKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { total_credits: 100, total_usage: 25 } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = await getProviderUsage(["openrouter"]);
      expect(first.providers[0]!.id).toBe("openrouter");
      const callsAfterFirst = fetchMock.mock.calls.length;
      // Sanity: the adapter actually hit the network on the cold call.
      expect(callsAfterFirst).toBeGreaterThan(0);

      const second = await getProviderUsage(["openrouter"]);
      expect(second.providers[0]!.id).toBe("openrouter");
      // Served from the TTL cache — the adapter did not run (no new fetches).
      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevKey;
    }
  });
});
