import { beforeEach, describe, expect, it } from "vitest";

const {
  rateLimit,
  remotePtyScopeKey,
  remoteRuntimeDisabled,
  resetRateLimitsForTests,
} = await Promise.all([
  import("../rate-limits"),
  import("../daytona-remote-pty"),
]).then(([rateLimits, remotePty]) => ({
  ...rateLimits,
  ...remotePty,
}));

describe("hosted abuse controls", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    delete process.env.MC_REMOTE_RUNTIME_DISABLED;
  });

  it("returns 429 after a fixed-window limit is exhausted", async () => {
    expect(rateLimit("test:bucket", { limit: 1, windowMs: 60_000 }).ok).toBe(true);
    const limited = rateLimit("test:bucket", { limit: 1, windowMs: 60_000 });

    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.response.status).toBe(429);
      expect(limited.response.headers.get("retry-after")).toBe("60");
    }
  });

  it("recognizes emergency remote runtime disable values", () => {
    process.env.MC_REMOTE_RUNTIME_DISABLED = "true";
    expect(remoteRuntimeDisabled()).toBe(true);
    process.env.MC_REMOTE_RUNTIME_DISABLED = "1";
    expect(remoteRuntimeDisabled()).toBe(true);
    process.env.MC_REMOTE_RUNTIME_DISABLED = "";
    expect(remoteRuntimeDisabled()).toBe(false);
  });

  it("scopes remote PTY limits to organization or user", () => {
    expect(
      remotePtyScopeKey({
        sessionId: "hs-1",
        academyUserId: "academy-user-1",
        userId: "user-1",
        email: "user@example.com",
        organizationId: null,
      }),
    ).toBe("user:user-1");
    expect(
      remotePtyScopeKey({
        sessionId: "hs-1",
        academyUserId: "academy-user-1",
        userId: "user-1",
        email: "user@example.com",
        organizationId: "org-1",
      }),
    ).toBe("org:org-1");
  });
});
