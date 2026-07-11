import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPetSnapshot,
  isNightHour,
  MOOD_DEBOUNCE_MS,
  PET_MOVES_PER_MOOD,
  petHydrate,
  petIngestServerEvent,
  petInteract,
  petPulse,
  petSetEnabled,
  petUserActivity,
  resolvePetMood,
  type PetInputs,
} from "./pet-store";

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

describe("move variants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 11, 12, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("rolls a fresh move on every mood change, never repeating back-to-back", () => {
    petHydrate(null);
    petSetEnabled(true, false, false);
    const celebrationMoves: number[] = [];
    let prev = getPetSnapshot().move;

    for (let i = 0; i < 30; i++) {
      petPulse("celebrate");
      const snap = getPetSnapshot();
      expect(snap.mood).toBe("celebrating");
      expect(snap.move).toBeGreaterThanOrEqual(0);
      expect(snap.move).toBeLessThan(PET_MOVES_PER_MOOD);
      // Entering a mood must land on a different variant than whatever
      // was playing before it.
      expect(snap.move).not.toBe(prev);
      celebrationMoves.push(snap.move);

      // Let the 5s celebration expire, then settle through the calm-mood
      // debounce back to idle before the next celebration.
      vi.advanceTimersByTime(6_000);
      petUserActivity("pointer");
      vi.advanceTimersByTime(1_500);
      expect(getPetSnapshot().mood).toBe("idle");
      prev = getPetSnapshot().move;
      expect(prev).not.toBe(celebrationMoves[celebrationMoves.length - 1]);
    }

    // 30 draws from 10 variants: seeing ≤3 distinct ones is astronomically
    // unlikely unless the roll is broken.
    expect(new Set(celebrationMoves).size).toBeGreaterThan(3);
  });

  it("petting fires a random one-shot reaction, never repeating back-to-back", () => {
    petHydrate(null);
    petSetEnabled(true, false, false);
    const kinds: string[] = [];
    let prev: string | null = null;

    for (let i = 0; i < 30; i++) {
      petInteract();
      const { flourish } = getPetSnapshot();
      expect(flourish).not.toBeNull();
      expect(flourish!.kind).not.toBe(prev);
      prev = flourish!.kind;
      kinds.push(flourish!.kind);
      // Let the flourish clear before the next click.
      vi.advanceTimersByTime(1_500);
      expect(getPetSnapshot().flourish).toBeNull();
    }

    expect(new Set(kinds).size).toBeGreaterThan(3);
  });
});

describe("prompt:submitted reaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A distinctly later clock than the other suites: the store's inputs and
    // pulse timers are module-level and leak across tests, so any celebrate/
    // startle window left behind must fall safely in the past.
    vi.setSystemTime(new Date(2026, 6, 11, 14, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("perks to watching, hops, and speaks when a prompt is sent", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    // Let any leaked celebrate/startle pulse from a prior suite lapse.
    vi.advanceTimersByTime(30_000);

    petIngestServerEvent({
      type: "prompt:submitted",
      taskId: "t1",
      projectId: "p1",
      snippet: "just chatting, no keywords here",
    } as never);

    // The excited hop and an acknowledgment (here the generic fallback line)
    // land immediately.
    const immediate = getPetSnapshot();
    expect(immediate.flourish).not.toBeNull();
    expect(immediate.bubble).not.toBeNull();

    // The send counts as a fresh keystroke; after the calm-mood debounce the
    // pet has perked from idle to watching.
    vi.advanceTimersByTime(MOOD_DEBOUNCE_MS + 100);
    expect(getPetSnapshot().mood).toBe("watching");
  });

  it("stays quiet on flourish when messages are disabled but still hops", () => {
    petHydrate(null);
    petSetEnabled(true, false, false);
    petIngestServerEvent({
      type: "prompt:submitted",
      taskId: "t2",
      projectId: "p1",
      snippet: "refactor the parser",
    } as never);
    const snap = getPetSnapshot();
    expect(snap.flourish).not.toBeNull();
    expect(snap.bubble).toBeNull();
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
