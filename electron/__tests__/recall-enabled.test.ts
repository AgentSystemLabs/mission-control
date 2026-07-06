import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { fetchRecallEnabled } from "../recall-enabled";
import type { PtyHookEnv } from "../pty-hook-env";

const MC_ENV: PtyHookEnv = { apiUrl: "http://127.0.0.1:5174", token: "test-token" };

describe("fetchRecallEnabled", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the boolean from the settings payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ recallEnabled: false }))),
    );
    expect(await fetchRecallEnabled(MC_ENV)).toBe(false);
  });

  it("returns null (unknown) without an API env", async () => {
    expect(await fetchRecallEnabled(null)).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await fetchRecallEnabled(MC_ENV)).toBeNull();
  });

  it("returns null when the payload has no boolean flag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}))));
    expect(await fetchRecallEnabled(MC_ENV)).toBeNull();
  });

  it("returns null when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await fetchRecallEnabled(MC_ENV)).toBeNull();
  });
});
