import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyEntitlementClaims } from "../academy-auth";

const poolQuery = vi.hoisted(() => vi.fn());

vi.mock("../../hosted-pg", () => ({
  getHostedPool: () => ({ query: poolQuery }),
  isHostedDatabaseEnabled: () => true,
}));

vi.mock("../settings", () => ({
  getOrCreateAuthSecret: () => "test-session-secret",
}));

const {
  createHostedSessionFromAcademy,
  renewHostedSessionIfNeeded,
  syncAcademyEntitlementClaims,
} = await import("../academy-auth");

function academyClaims(overrides: Record<string, unknown> = {}): AcademyEntitlementClaims {
  return {
    audience: "mission-control",
    academyUserId: "academy-user-1",
    email: "user@example.com",
    emailVerified: true,
    missionControlHosted: true,
    remoteRuntimeEnabled: true,
    sourceTier: "operators",
    billingStatus: "active",
    currentPeriodStartsAt: "2026-05-01T00:00:00.000Z",
    currentPeriodEndsAt: "2026-06-01T00:00:00.000Z",
    accessEndsAt: "2026-06-01T00:00:00.000Z",
    issuedAt: "2026-05-17T00:00:00.000Z",
    expiresAt: "2026-05-17T00:05:00.000Z",
    entitlementVersion: "ent_v1",
    ...overrides,
  } as AcademyEntitlementClaims;
}

function mockAcademyClaims(claims: Record<string, unknown>) {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(claims), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("Academy hosted auth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T00:01:00.000Z"));
    poolQuery.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    process.env.ACADEMY_ENTITLEMENTS_API_URL = "https://academy.example/api/exchange";
    process.env.ACADEMY_ENTITLEMENTS_API_SECRET = "exchange-secret";
    process.env.MC_SESSION_SECRET = "mc-session-secret";
    delete process.env.MC_SESSION_TTL_MINUTES;
    delete process.env.MC_SESSION_RENEWAL_WINDOW_MINUTES;
  });

  it("persists the Academy account link and latest entitlement version on exchange", async () => {
    mockAcademyClaims(academyClaims());
    poolQuery.mockResolvedValue({ rows: [] });

    const result = await createHostedSessionFromAcademy(
      new Request("https://mission.example/api/academy-auth/callback"),
      { code: "code-1" },
    );

    expect(result.cookie).toContain("mc_session=");
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`"academyAccountLink"`),
      expect.arrayContaining([
        "academy:academy-user-1",
        "academy-user-1",
        "user@example.com",
        "ent_v1",
      ]),
    );
  });

  it("revokes remote runtime when Academy returns a canceled claim", async () => {
    mockAcademyClaims(
      academyClaims({
        remoteRuntimeEnabled: false,
        billingStatus: "canceled",
        currentPeriodEndsAt: null,
        accessEndsAt: null,
        entitlementVersion: "ent_canceled",
      }),
    );
    poolQuery.mockResolvedValue({ rows: [] });

    await createHostedSessionFromAcademy(
      new Request("https://mission.example/api/academy-auth/callback"),
      { code: "code-1" },
    );

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`"subscriptionEntitlement"`),
      expect.arrayContaining(["academy:academy-user-1", "none", "canceled", false]),
    );
  });

  it("replays Academy claims for support without creating a browser session", async () => {
    poolQuery.mockResolvedValue({ rows: [] });

    const userId = await syncAcademyEntitlementClaims(
      academyClaims({
        entitlementVersion: "ent_replay_1",
        sourceTier: "operators",
      }),
    );

    expect(userId).toBe("academy:academy-user-1");
    expect(fetch).not.toHaveBeenCalled();
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`"academyAccountLink"`),
      expect.arrayContaining([
        "academy:academy-user-1",
        "academy-user-1",
        "user@example.com",
        "ent_replay_1",
      ]),
    );
    expect(poolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO "hostedSession"`),
      expect.anything(),
    );
  });

  it("rejects claims that do not grant hosted Mission Control access", async () => {
    mockAcademyClaims(
      academyClaims({
        missionControlHosted: false,
        remoteRuntimeEnabled: false,
        entitlementVersion: "ent_no_access",
      }),
    );

    await expect(
      createHostedSessionFromAcademy(
        new Request("https://mission.example/api/academy-auth/callback"),
        { code: "code-1" },
      ),
    ).rejects.toThrow("not entitled to hosted Mission Control");
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("rejects expired Academy claims", async () => {
    mockAcademyClaims(
      academyClaims({
        expiresAt: "2026-05-17T00:00:30.000Z",
        entitlementVersion: "ent_expired",
      }),
    );

    await expect(
      createHostedSessionFromAcademy(
        new Request("https://mission.example/api/academy-auth/callback"),
        { code: "code-1" },
      ),
    ).rejects.toThrow("expired");
  });

  it("rejects wrong-audience Academy claims", async () => {
    mockAcademyClaims(
      academyClaims({
        audience: "other-app",
        entitlementVersion: "ent_wrong_audience",
      }),
    );

    await expect(
      createHostedSessionFromAcademy(
        new Request("https://mission.example/api/academy-auth/callback"),
        { code: "code-1" },
      ),
    ).rejects.toThrow();
  });

  it("rotates hosted session tokens when they enter the renewal window", async () => {
    poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "hs-1",
            academyUserId: "academy-user-1",
            userId: "academy:academy-user-1",
            expiresAt: new Date("2026-05-17T00:30:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    process.env.MC_SESSION_TTL_MINUTES = "120";
    process.env.MC_SESSION_RENEWAL_WINDOW_MINUTES = "60";

    const cookie = await renewHostedSessionIfNeeded(
      new Request("https://mission.example/api/academy-auth/session", {
        headers: { cookie: "mc_session=old-token" },
      }),
    );

    expect(cookie).toContain("mc_session=");
    expect(cookie).not.toContain("old-token");
    expect(poolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`UPDATE "hostedSession"`),
      expect.arrayContaining(["hs-1", expect.any(String), new Date("2026-05-17T02:01:00.000Z")]),
    );
  });
});
