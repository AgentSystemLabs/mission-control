import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedAuthContext } from "../../hosted-auth-context";

const poolQuery = vi.hoisted(() => vi.fn());

vi.mock("../../hosted-pg", () => ({
  getHostedPool: () => ({ query: poolQuery }),
  isHostedDatabaseEnabled: () => true,
}));

const { readEntitlements } = await import("../entitlements");

const context: HostedAuthContext = {
  sessionId: "hs-1",
  academyUserId: "academy-user-1",
  userId: "user-1",
  email: "user@example.com",
  organizationId: null,
};

describe("hosted entitlements", () => {
  beforeEach(() => {
    poolQuery.mockReset();
    delete process.env.MC_BLOCKED_HOSTED_USER_IDS;
    delete process.env.MC_BLOCKED_ACADEMY_USER_IDS;
    delete process.env.MC_BLOCKED_ORGANIZATION_IDS;
  });

  it("requires auth before remote runtime is allowed", async () => {
    const entitlements = await readEntitlements(null);

    expect(entitlements.remoteRuntime).toMatchObject({
      allowed: false,
      reason: "auth-required",
      plan: "none",
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("requires a subscription entitlement for signed-in users", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });

    const entitlements = await readEntitlements(context);

    expect(entitlements.remoteRuntime).toMatchObject({
      allowed: false,
      reason: "subscription-required",
      plan: "none",
    });
  });

  it("denies remote runtime for blocked hosted accounts before reading subscriptions", async () => {
    process.env.MC_BLOCKED_ACADEMY_USER_IDS = "academy-user-1";

    const entitlements = await readEntitlements(context);

    expect(entitlements.remoteRuntime).toMatchObject({
      allowed: false,
      reason: "account-blocked",
      plan: "none",
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("allows current trial remote runtime entitlements", async () => {
    const trialEndsAt = new Date(Date.now() + 60_000);
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          plan: "trial",
          status: "trialing",
          remoteRuntimeEnabled: true,
          trialEndsAt,
          currentPeriodEndsAt: null,
        },
      ],
    });

    const entitlements = await readEntitlements(context);

    expect(entitlements.remoteRuntime).toMatchObject({
      allowed: true,
      reason: null,
      plan: "trial",
      trialEndsAt: trialEndsAt.toISOString(),
    });
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`"subscriptionEntitlement"`),
      [null, "user-1"],
    );
  });

  it("allows active paid remote runtime entitlements", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          plan: "paid",
          status: "active",
          remoteRuntimeEnabled: true,
          trialEndsAt: null,
          currentPeriodEndsAt: new Date(Date.now() + 60_000),
        },
      ],
    });

    const entitlements = await readEntitlements(context);

    expect(entitlements.remoteRuntime).toMatchObject({
      allowed: true,
      reason: null,
      plan: "paid",
      trialEndsAt: null,
    });
  });

  it("rejects expired trials", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          plan: "trial",
          status: "trialing",
          remoteRuntimeEnabled: true,
          trialEndsAt: new Date(Date.now() - 60_000),
          currentPeriodEndsAt: null,
        },
      ],
    });

    const entitlements = await readEntitlements(context);

    expect(entitlements.remoteRuntime).toMatchObject({
      allowed: false,
      reason: "subscription-required",
      plan: "none",
    });
  });
});
