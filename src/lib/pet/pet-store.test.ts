import { describe, expect, it } from "vitest";
import { isNightHour, resolvePetMood, type PetInputs } from "./pet-store";

const NOW = 10_000_000;

function inputs(overrides: Partial<PetInputs> = {}): PetInputs {
  return {
    runningCount: 0,
    needsInputCount: 0,
    shippingActive: false,
    startleUntil: 0,
    celebrateUntil: 0,
    lastKeyAt: 0,
    lastActivityAt: NOW,
    hiddenSince: null,
    ...overrides,
  };
}

describe("resolvePetMood priority", () => {
  it("defaults to idle", () => {
    expect(resolvePetMood(inputs(), NOW).mood).toBe("idle");
  });

  it("alert beats everything", () => {
    const result = resolvePetMood(
      inputs({
        needsInputCount: 1,
        shippingActive: true,
        startleUntil: NOW + 1000,
        celebrateUntil: NOW + 1000,
        runningCount: 5,
      }),
      NOW,
    );
    expect(result.mood).toBe("alert");
  });

  it("startled beats shipping, which beats celebrating, which beats working", () => {
    const base = {
      shippingActive: true,
      startleUntil: NOW + 1000,
      celebrateUntil: NOW + 1000,
      runningCount: 2,
    };
    expect(resolvePetMood(inputs(base), NOW).mood).toBe("startled");
    expect(resolvePetMood(inputs({ ...base, startleUntil: 0 }), NOW).mood).toBe("shipping");
    expect(
      resolvePetMood(inputs({ ...base, startleUntil: 0, shippingActive: false }), NOW).mood,
    ).toBe("celebrating");
    expect(
      resolvePetMood(
        inputs({ ...base, startleUntil: 0, shippingActive: false, celebrateUntil: 0 }),
        NOW,
      ).mood,
    ).toBe("working");
  });

  it("expired pulses stop mattering", () => {
    expect(
      resolvePetMood(inputs({ startleUntil: NOW - 1, celebrateUntil: NOW - 1 }), NOW).mood,
    ).toBe("idle");
  });

  it("working intensity scales with running count", () => {
    expect(resolvePetMood(inputs({ runningCount: 1 }), NOW).intensity).toBe(1);
    expect(resolvePetMood(inputs({ runningCount: 2 }), NOW).intensity).toBe(2);
    expect(resolvePetMood(inputs({ runningCount: 3 }), NOW).intensity).toBe(2);
    expect(resolvePetMood(inputs({ runningCount: 4 }), NOW).intensity).toBe(3);
  });

  it("recent keystrokes read as watching, decaying after 8s", () => {
    expect(resolvePetMood(inputs({ lastKeyAt: NOW - 3_000 }), NOW).mood).toBe("watching");
    expect(resolvePetMood(inputs({ lastKeyAt: NOW - 9_000 }), NOW).mood).toBe("idle");
  });

  it("sleeps after 5 minutes without activity or 60s hidden", () => {
    expect(resolvePetMood(inputs({ lastActivityAt: NOW - 6 * 60_000 }), NOW).mood).toBe(
      "sleeping",
    );
    expect(resolvePetMood(inputs({ hiddenSince: NOW - 61_000 }), NOW).mood).toBe("sleeping");
    expect(resolvePetMood(inputs({ hiddenSince: NOW - 30_000 }), NOW).mood).toBe("idle");
  });

  it("agents keep working even while the window is hidden", () => {
    expect(
      resolvePetMood(inputs({ runningCount: 1, hiddenSince: NOW - 120_000 }), NOW).mood,
    ).toBe("working");
  });
});

describe("isNightHour", () => {
  it("flags late-night and early-morning hours", () => {
    const at = (hour: number) => new Date(2026, 6, 11, hour, 0, 0).getTime();
    expect(isNightHour(at(23))).toBe(true);
    expect(isNightHour(at(2))).toBe(true);
    expect(isNightHour(at(5))).toBe(true);
    expect(isNightHour(at(6))).toBe(false);
    expect(isNightHour(at(12))).toBe(false);
    expect(isNightHour(at(21))).toBe(false);
    expect(isNightHour(at(22))).toBe(true);
  });
});
