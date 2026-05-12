import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-settings-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getDb } = await import("~/db/client");
const { appSettings } = await import("~/db/schema");
const { ensureApiTokenBootstrap } = await import("../bootstrap");

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function authedHeaders(extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${ensureApiTokenBootstrap()}`, ...(extra ?? {}) };
}

describe("settings API", () => {
  beforeEach(() => {
    getDb().delete(appSettings).run();
  });

  it("keeps mouse gradients enabled by default", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/api/settings", { headers: authedHeaders() }),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      mouseGradientDisabled: false,
    });
  });

  it("persists the mouse gradient preference", async () => {
    const update = await handleApiRequest(
      new Request("http://localhost/api/settings", {
        method: "POST",
        headers: authedHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ mouseGradientDisabled: true }),
      }),
    );
    const read = await handleApiRequest(
      new Request("http://localhost/api/settings", { headers: authedHeaders() }),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      mouseGradientDisabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      mouseGradientDisabled: true,
    });
  });
});
