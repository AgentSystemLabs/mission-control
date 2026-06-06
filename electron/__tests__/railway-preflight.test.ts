import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  RAILWAY_CLI_LOGIN_HINT,
  checkRailwayPreflight,
} from "../railway-preflight";

const spawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawnSync }));

describe("checkRailwayPreflight", () => {
  beforeEach(() => {
    spawnSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports when the Railway CLI is missing", () => {
    spawnSync.mockReturnValueOnce({ error: { code: "ENOENT" } });
    expect(checkRailwayPreflight()).toEqual({
      ok: false,
      error: expect.stringContaining("railway CLI is required"),
    });
  });

  it("reports when Git is missing", () => {
    spawnSync
      .mockReturnValueOnce({ error: null, status: 0 })
      .mockReturnValueOnce({ error: { code: "ENOENT" } });
    expect(checkRailwayPreflight()).toEqual({
      ok: false,
      error: expect.stringContaining("Git is required"),
    });
  });

  it("reports when the Railway CLI is not logged in", () => {
    spawnSync
      .mockReturnValueOnce({ error: null, status: 0 })
      .mockReturnValueOnce({ error: null, status: 0 })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "Unauthorized" });
    expect(checkRailwayPreflight()).toEqual({ ok: false, error: RAILWAY_CLI_LOGIN_HINT });
  });

  it("passes when railway whoami succeeds", () => {
    spawnSync
      .mockReturnValueOnce({ error: null, status: 0 })
      .mockReturnValueOnce({ error: null, status: 0 })
      .mockReturnValueOnce({ status: 0, stdout: "webdevcody\n", stderr: "" });
    expect(checkRailwayPreflight()).toEqual({ ok: true });
  });
});
