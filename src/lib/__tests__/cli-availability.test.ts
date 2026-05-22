import { describe, expect, it } from "vitest";
import { cliAvailabilityFromCheckResult } from "../cli-availability";

describe("cliAvailabilityFromCheckResult", () => {
  it("marks a successful CLI check as available", () => {
    expect(
      cliAvailabilityFromCheckResult({
        ok: true,
        path: "/usr/local/bin/codex",
        version: "0.132.0",
      }),
    ).toEqual({
      status: "available",
      path: "/usr/local/bin/codex",
      version: "0.132.0",
    });
  });

  it("marks an old Codex version as outdated instead of missing", () => {
    expect(
      cliAvailabilityFromCheckResult({
        ok: false,
        reason: "outdated",
        path: "/usr/local/bin/codex",
        version: "0.131.0",
        requiredVersion: "0.132.0",
      }),
    ).toEqual({
      status: "outdated",
      reason: "outdated",
      path: "/usr/local/bin/codex",
      version: "0.131.0",
      requiredVersion: "0.132.0",
    });
  });

  it("keeps a missing CLI distinct from an outdated CLI", () => {
    expect(cliAvailabilityFromCheckResult({ ok: false, reason: "not-found" })).toEqual({
      status: "missing",
      reason: "not-found",
    });
  });
});
