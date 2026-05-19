import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-settings-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getDb } = await import("~/db/client");
const { appSettings } = await import("~/db/schema");
const { getOrCreateApiToken } = await import("../services/settings");

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function authedRequest(input: string | URL, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) {
    headers.set("authorization", `Bearer ${getOrCreateApiToken()}`);
  }
  return new Request(input, { ...init, headers });
}

describe("settings API", () => {
  beforeEach(() => {
    getDb().delete(appSettings).run();
  });

  it("keeps mouse gradients enabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      mouseGradientDisabled: false,
    });
  });

  it("keeps the launch intro disabled by default", async () => {
    const response = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(response?.status).toBe(200);
    expect(await jsonBody(response!)).toMatchObject({
      launchOverlayEnabled: false,
    });
  });

  it("persists the mouse gradient preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mouseGradientDisabled: true }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      mouseGradientDisabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      mouseGradientDisabled: true,
    });
  });

  it("persists the launch intro preference", async () => {
    const update = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchOverlayEnabled: true }),
      }),
    );
    const read = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );

    expect(update?.status).toBe(200);
    expect(await jsonBody(update!)).toMatchObject({
      launchOverlayEnabled: true,
    });
    expect(await jsonBody(read!)).toMatchObject({
      launchOverlayEnabled: true,
    });
  });

  // Regression: GET /api/settings used to anonymously return the API bearer
  // token in the JSON body, collapsing the entire auth tier.
  // See todos/bugs/done/02-api-settings-leaks-bearer-token.md.
  it("never returns the API bearer token over HTTP", async () => {
    const token = getOrCreateApiToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const getResponse = await handleApiRequest(
      authedRequest("http://localhost/api/settings"),
    );
    const getBody = await jsonBody(getResponse!);
    expect(getResponse?.status).toBe(200);
    expect(getBody).not.toHaveProperty("apiToken");
    expect(JSON.stringify(getBody)).not.toContain(token);

    const postResponse = await handleApiRequest(
      authedRequest("http://localhost/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      }),
    );
    // The schema rejects `regenerate` outright (strict object) so the request
    // never reaches a code path that could rotate or echo the token.
    expect(postResponse?.status).toBe(400);
    const postBody = await jsonBody(postResponse!);
    expect(postBody).not.toHaveProperty("apiToken");
    expect(JSON.stringify(postBody)).not.toContain(token);

    const tokenAfterRegenerateAttempt = getOrCreateApiToken();
    expect(tokenAfterRegenerateAttempt).toBe(token);
  });
});
