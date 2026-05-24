import { afterEach, describe, expect, it } from "vitest";
import { hostedCleanupStatusForCurrentRuntime } from "../hosted-cleanup-status";

afterEach(() => {
  delete (globalThis as any).window;
});

describe("hostedCleanupStatusForCurrentRuntime", () => {
  it("returns hosted cleanup copy for web Daytona runtime", () => {
    expect(hostedCleanupStatusForCurrentRuntime("session")).toBe(
      "Cleaning up hosted resources for this session. If the hosted environment is unavailable, cleanup will be retried.",
    );
  });

  it("suppresses hosted cleanup copy in Electron runtime", () => {
    (globalThis as any).window = { electronAPI: {} };

    expect(hostedCleanupStatusForCurrentRuntime("session")).toBeNull();
    expect(hostedCleanupStatusForCurrentRuntime("project")).toBeNull();
    expect(hostedCleanupStatusForCurrentRuntime("finishedSessions")).toBeNull();
    expect(hostedCleanupStatusForCurrentRuntime("disconnectedSessions")).toBeNull();
  });
});
