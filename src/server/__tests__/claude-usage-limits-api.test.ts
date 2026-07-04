import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-claude-usage-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { _setTokenReaderForTests, _resetClaudeUsageLimitsCache } = await import(
  "../services/claude-usage-limits"
);

function authedRequest(input: string): Request {
  return new Request(input, {
    headers: { authorization: `Bearer ${getOrCreateApiToken()}` },
  });
}

describe("GET /api/claude-usage-limits", () => {
  beforeEach(() => {
    _resetClaudeUsageLimitsCache();
  });
  afterEach(() => {
    _setTokenReaderForTests(null);
    _resetClaudeUsageLimitsCache();
    vi.unstubAllGlobals();
  });

  it("returns unauthenticated (no network) when there is no Claude login", async () => {
    _setTokenReaderForTests(() => null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleApiRequest(
      authedRequest("http://localhost/api/claude-usage-limits"),
    );
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({ status: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns mapped session + weekly windows on success", async () => {
    _setTokenReaderForTests(() => "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              five_hour: { utilization: 48, resets_at: "2026-07-10T06:49:00Z" },
              seven_day: { utilization: 36, resets_at: "2026-07-13T15:59:00Z" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const response = await handleApiRequest(
      authedRequest("http://localhost/api/claude-usage-limits"),
    );
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      status: "ok",
      session: { utilization: 48, resetsAt: "2026-07-10T06:49:00Z" },
      weekly: { utilization: 36 },
    });
  });
});
