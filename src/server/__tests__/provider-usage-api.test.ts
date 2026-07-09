import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-provider-usage-api-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const {
  _setTokenReaderForTests,
  _resetClaudeUsageLimitsCache,
  _setSharedLimitsFileForTests,
} = await import("../services/claude-usage-limits");
const {
  _resetCodexUsageCache,
  _resetCursorUsageCache,
  _setCodexCredsReaderForTests,
  _setCursorSessionReaderForTests,
} = await import("../services/provider-usage");

function authedRequest(input: string): Request {
  return new Request(input, {
    headers: { authorization: `Bearer ${getOrCreateApiToken()}` },
  });
}

describe("GET /api/provider-usage", () => {
  beforeEach(() => {
    _resetClaudeUsageLimitsCache();
    _resetCodexUsageCache();
    _resetCursorUsageCache();
    _setSharedLimitsFileForTests(path.join(tmpRoot, "limits.json"));
    fs.rmSync(path.join(tmpRoot, "limits.json"), { force: true });
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
    vi.unstubAllGlobals();
  });

  it("returns structured multi-provider payload (not Claude-only legacy shape)", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const response = await handleApiRequest(
      authedRequest("http://localhost/api/provider-usage?providers=claude,codex,cursor"),
    );
    expect(response?.status).toBe(200);
    const body = await response!.json();
    expect(body).toMatchObject({
      providers: expect.any(Array),
      fetchedAt: expect.any(Number),
    });
    expect(body.providers).toHaveLength(3);
    for (const p of body.providers) {
      expect(p).toMatchObject({
        id: expect.any(String),
        displayName: expect.any(String),
        status: expect.stringMatching(/^(ok|unauthenticated|rate_limited|error|unavailable)$/),
        windows: expect.any(Array),
        fetchedAt: expect.any(Number),
      });
    }
    // Explicit multi-provider shape — not a flat Claude-only object.
    expect(body.session).toBeUndefined();
    expect(body.weekly).toBeUndefined();
  });

  it("maps successful Claude + Codex fetch through the real API entry", async () => {
    _setTokenReaderForTests(() => "test-token");
    _setCodexCredsReaderForTests(() => ({ accessToken: "codex-tok", accountId: null }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("anthropic.com")) {
          return new Response(
            JSON.stringify({
              five_hour: { utilization: 11, resets_at: "2026-07-10T06:49:00Z" },
              seven_day: { utilization: 22, resets_at: "2026-07-13T15:59:00Z" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (String(url).includes("wham/usage")) {
          return new Response(
            JSON.stringify({
              rate_limit: {
                primary_window: {
                  used_percent: 33,
                  reset_at: 1_720_000_000,
                  limit_window_seconds: 18_000,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("", { status: 404 });
      }),
    );

    const response = await handleApiRequest(
      authedRequest("http://localhost/api/provider-usage?providers=claude,codex"),
    );
    expect(response?.status).toBe(200);
    const body = await response!.json();
    const claude = body.providers.find((p: { id: string }) => p.id === "claude");
    const codex = body.providers.find((p: { id: string }) => p.id === "codex");
    expect(claude.status).toBe("ok");
    expect(claude.windows.some((w: { utilization: number }) => w.utilization === 11)).toBe(true);
    expect(codex.status).toBe("ok");
    expect(codex.windows.some((w: { utilization: number }) => w.utilization === 33)).toBe(true);
  });
});
