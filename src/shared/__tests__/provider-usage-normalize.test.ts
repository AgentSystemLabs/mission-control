import { describe, expect, it } from "vitest";
import {
  claudeLimitsToProviderSnapshot,
  normalizeClaudeUsagePayload,
  normalizeCodexUsagePayload,
  normalizeCrofUsagePayload,
  normalizeCursorUsagePayload,
  normalizeDeepSeekUsagePayload,
  normalizeElevenLabsUsagePayload,
  normalizeKimiK2UsagePayload,
  normalizeMoonshotUsagePayload,
  normalizeOpenRouterUsagePayload,
  normalizePoeUsagePayload,
  stubProviderSnapshot,
} from "../provider-usage-normalize";
import {
  DEFAULT_PROVIDER_USAGE_IDS,
  isProviderUsageId,
  normalizeProviderUsageIds,
  PROVIDER_USAGE_CATALOG,
  PROVIDER_USAGE_IDS,
} from "../provider-usage";

describe("provider-usage catalog (CodexBar fork)", () => {
  it("includes the full CodexBar provider id set", () => {
    expect(PROVIDER_USAGE_IDS.length).toBeGreaterThanOrEqual(50);
    expect(PROVIDER_USAGE_CATALOG.map((p) => p.id).sort()).toEqual(
      [...PROVIDER_USAGE_IDS].sort(),
    );
    expect(isProviderUsageId("claude")).toBe(true);
    expect(isProviderUsageId("codex")).toBe(true);
    expect(isProviderUsageId("cursor")).toBe(true);
    expect(isProviderUsageId("not-a-provider")).toBe(false);
  });

  it("defaults enabled providers to the mission-control agent surface", () => {
    expect(DEFAULT_PROVIDER_USAGE_IDS).toEqual(["claude", "codex", "cursor"]);
    expect(normalizeProviderUsageIds(["claude", "bogus", "claude", "codex"])).toEqual([
      "claude",
      "codex",
    ]);
  });
});

describe("normalizeClaudeUsagePayload", () => {
  it("maps five_hour/seven_day/seven_day_opus into windows", () => {
    const snap = normalizeClaudeUsagePayload({
      five_hour: { utilization: 48, resets_at: "2026-07-10T06:49:00Z" },
      seven_day: { utilization: 36, resets_at: "2026-07-13T15:59:00Z" },
      seven_day_opus: { utilization: 12, resets_at: "2026-07-13T15:59:00Z" },
    });
    expect(snap.id).toBe("claude");
    expect(snap.status).toBe("ok");
    expect(snap.windows).toEqual([
      { id: "session", label: "session", utilization: 48, resetsAt: "2026-07-10T06:49:00.000Z" },
      { id: "weekly", label: "week", utilization: 36, resetsAt: "2026-07-13T15:59:00.000Z" },
      { id: "weeklyOpus", label: "opus", utilization: 12, resetsAt: "2026-07-13T15:59:00.000Z" },
    ]);
  });

  it("prefers seven_day_sonnet over seven_day_opus for the model-week slot", () => {
    const snap = normalizeClaudeUsagePayload({
      five_hour: { utilization: 5, resets_at: "2026-07-10T06:49:00Z" },
      seven_day_sonnet: { utilization: 33, resets_at: "2026-07-13T15:59:00Z" },
      seven_day_opus: { utilization: 12, resets_at: "2026-07-13T15:59:00Z" },
    });
    const model = snap.windows.find((w) => w.id === "weeklyOpus");
    expect(model).toMatchObject({ label: "sonnet", utilization: 33 });
  });

  it("claudeLimitsToProviderSnapshot preserves status and windows", () => {
    const snap = claudeLimitsToProviderSnapshot({
      session: { utilization: 10, resetsAt: "2026-07-10T00:00:00.000Z" },
      weekly: null,
      weeklyOpus: null,
      status: "ok",
      fetchedAt: 123,
    });
    expect(snap.windows).toHaveLength(1);
    expect(snap.fetchedAt).toBe(123);
  });
});

describe("normalizeCodexUsagePayload", () => {
  it("maps primary/secondary windows with unix reset_at", () => {
    const snap = normalizeCodexUsagePayload({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 42,
          reset_at: 1_720_000_000,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          used_percent: 15,
          reset_at: 1_720_500_000,
          limit_window_seconds: 604_800,
        },
      },
    });
    expect(snap.id).toBe("codex");
    expect(snap.status).toBe("ok");
    expect(snap.windows[0]).toMatchObject({ id: "session", utilization: 42 });
    expect(snap.windows[1]).toMatchObject({ id: "weekly", utilization: 15 });
    expect(snap.windows[0]!.resetsAt).toBe(new Date(1_720_000_000 * 1000).toISOString());
  });

  it("swaps weekly primary into secondary lane (CodexRateWindowNormalizer)", () => {
    const snap = normalizeCodexUsagePayload({
      rate_limit: {
        primary_window: {
          used_percent: 80,
          reset_at: 1_720_500_000,
          limit_window_seconds: 604_800,
        },
        secondary_window: {
          used_percent: 20,
          reset_at: 1_720_000_000,
          limit_window_seconds: 18_000,
        },
      },
    });
    expect(snap.windows[0]).toMatchObject({ id: "session", utilization: 20 });
    expect(snap.windows[1]).toMatchObject({ id: "weekly", utilization: 80 });
  });

  it("promotes a lone unknown-length secondary window to the session lane", () => {
    const snap = normalizeCodexUsagePayload({
      rate_limit: {
        secondary_window: { used_percent: 55, reset_at: 1_720_000_000 },
      },
    });
    expect(snap.windows).toHaveLength(1);
    expect(snap.windows[0]).toMatchObject({ id: "session", utilization: 55 });
  });
});

describe("normalizeCursorUsagePayload", () => {
  it("maps plan totalPercentUsed + auto/api breakdown", () => {
    const snap = normalizeCursorUsagePayload({
      billingCycleEnd: "2026-08-01T00:00:00.000Z",
      individualUsage: {
        plan: {
          totalPercentUsed: 63.5,
          autoPercentUsed: 40,
          apiPercentUsed: 12,
        },
      },
    });
    expect(snap.id).toBe("cursor");
    expect(snap.status).toBe("ok");
    expect(snap.windows).toEqual([
      {
        id: "plan",
        label: "plan",
        utilization: 63.5,
        resetsAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "auto",
        label: "auto",
        utilization: 40,
        resetsAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "api",
        label: "api",
        utilization: 12,
        resetsAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("derives plan percent from cents when totalPercentUsed is absent", () => {
    const snap = normalizeCursorUsagePayload({
      individualUsage: {
        plan: { used: 500, limit: 2000 },
      },
    });
    expect(snap.windows[0]).toMatchObject({ id: "plan", utilization: 25 });
  });

  it("falls back to avg(auto, api) and clamps to 100 (CursorStatusProbe chain)", () => {
    const snap = normalizeCursorUsagePayload({
      individualUsage: {
        plan: { autoPercentUsed: 130, apiPercentUsed: 50 },
      },
    });
    // auto clamps to 100; headline = avg(100, 50) = 75.
    expect(snap.windows.find((w) => w.id === "plan")).toMatchObject({ utilization: 75 });
    expect(snap.windows.find((w) => w.id === "auto")).toMatchObject({ utilization: 100 });
  });

  it("uses teamUsage.pooled when the personal plan block is absent", () => {
    const snap = normalizeCursorUsagePayload({
      teamUsage: { pooled: { used: 30, limit: 120 } },
    });
    expect(snap.windows[0]).toMatchObject({ id: "plan", utilization: 25 });
  });
});

describe("stubProviderSnapshot", () => {
  it("keeps legacy unavailable fixture for fixtures that still import it", () => {
    const snap = stubProviderSnapshot("openrouter");
    expect(snap.status).toBe("unavailable");
    expect(snap.windows).toEqual([]);
    expect(snap.error).toMatch(/not yet ported/i);
  });
});

describe("normalizeOpenRouterUsagePayload", () => {
  it("maps credits total/usage into a balance window", () => {
    const snap = normalizeOpenRouterUsagePayload({
      data: { total_credits: 100, total_usage: 25 },
    });
    expect(snap.status).toBe("ok");
    expect(snap.windows[0]).toMatchObject({ id: "balance", utilization: 25 });
  });
});

describe("normalizeDeepSeekUsagePayload", () => {
  it("prefers USD balance_infos entry", () => {
    const snap = normalizeDeepSeekUsagePayload({
      balance_infos: [
        { currency: "CNY", total_balance: 10, granted_balance: 0, topped_up_balance: 10 },
        { currency: "USD", total_balance: 42.5, granted_balance: 2.5, topped_up_balance: 40 },
      ],
    });
    expect(snap.status).toBe("ok");
    expect(snap.windows[0]?.id).toBe("balance");
    // Balance-only: meterless window carrying the value, no fake 0% bar.
    expect(snap.windows[0]?.utilization).toBeNull();
    expect(snap.windows[0]?.detail).toMatch(/42\.5/);
    expect(snap.error).toBeUndefined();
  });
});

describe("normalizeElevenLabsUsagePayload", () => {
  it("maps character_count/limit to percent", () => {
    const snap = normalizeElevenLabsUsagePayload({
      character_count: 2500,
      character_limit: 10000,
      next_character_count_reset_unix: 1_720_000_000,
    });
    expect(snap.status).toBe("ok");
    expect(snap.windows[0]).toMatchObject({ id: "characters", utilization: 25 });
    expect(snap.windows[0]!.resetsAt).toBeTruthy();
  });
});

describe("normalizeMoonshotUsagePayload", () => {
  it("maps available_balance", () => {
    const snap = normalizeMoonshotUsagePayload({
      data: { available_balance: 12.3, voucher_balance: 0, cash_balance: 12.3 },
    });
    expect(snap.status).toBe("ok");
    expect(snap.windows[0]?.utilization).toBeNull();
    expect(snap.windows[0]?.detail).toMatch(/12\.3/);
  });
});

describe("normalizeKimiK2UsagePayload", () => {
  it("computes utilization from consumed + remaining", () => {
    const snap = normalizeKimiK2UsagePayload({
      total_credits_consumed: 30,
      credits_remaining: 70,
    });
    expect(snap.windows[0]).toMatchObject({ id: "credits", utilization: 30 });
  });
});

describe("normalizePoeUsagePayload", () => {
  it("maps current_point_balance", () => {
    const snap = normalizePoeUsagePayload({ current_point_balance: 9001 });
    expect(snap.status).toBe("ok");
    expect(snap.windows[0]?.utilization).toBeNull();
    expect(snap.windows[0]?.detail).toMatch(/9001/);
  });
});

describe("normalizeCrofUsagePayload", () => {
  it("maps request plan and credits", () => {
    const snap = normalizeCrofUsagePayload({
      requests_plan: 100,
      usable_requests: 40,
      credits: 5.5,
    });
    expect(snap.status).toBe("ok");
    expect(snap.windows.find((w) => w.id === "requests")?.utilization).toBe(60);
    expect(snap.windows.some((w) => w.id === "credits")).toBe(true);
  });
});

describe("catalog implemented flags", () => {
  it("marks every catalog provider implemented", () => {
    expect(PROVIDER_USAGE_CATALOG.every((p) => p.implemented)).toBe(true);
  });
});
