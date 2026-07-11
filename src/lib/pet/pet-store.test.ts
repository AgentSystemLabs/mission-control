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
  petShipResult,
  petStroke,
  petUserActivity,
  resolvePetMood,
  type PetInputs,
} from "./pet-store";
import { PET_LINES } from "./pet-lines";

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

describe("hover/press interactivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Later clock than the other suites so their leaked module-level state
    // (petting XP cooldown, pulse windows) has safely lapsed.
    vi.setSystemTime(new Date(2026, 6, 11, 18, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("stroking bursts hearts every tick but XP only once per cooldown", () => {
    petHydrate(null);
    petSetEnabled(true, false, false);
    const before = getPetSnapshot();

    petStroke();
    vi.advanceTimersByTime(600);
    petStroke();
    vi.advanceTimersByTime(600);
    petStroke();

    const after = getPetSnapshot();
    expect(after.heartsBurstId).toBe(before.heartsBurstId + 3);
    expect(after.xp).toBe(before.xp + 1);
  });

  it("spam-clicking makes the pet dizzy and complains over the petting line", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    // Let the startle window from any earlier interaction lapse.
    vi.advanceTimersByTime(30_000);

    for (let i = 0; i < 4; i++) {
      const result = petInteract();
      expect(result.navigateTo).toBeNull();
      vi.advanceTimersByTime(100);
    }
    expect(getPetSnapshot().mood).not.toBe("startled");
    // The first click's petting line is still on screen.
    const pettingBubble = getPetSnapshot().bubble;
    expect(pettingBubble).not.toBeNull();

    const heartsBefore = getPetSnapshot().heartsBurstId;
    petInteract();
    const snap = getPetSnapshot();
    expect(snap.mood).toBe("startled");
    expect(snap.flourish?.kind).toBe("spin");
    // The dizzy click is not another petting: no fresh hearts.
    expect(snap.heartsBurstId).toBe(heartsBefore);
    // The overpet complaint preempts the visible petting bubble.
    expect(snap.bubble).not.toBeNull();
    expect(snap.bubble!.id).not.toBe(pettingBubble!.id);
    const overpetTexts = PET_LINES.overpet.map((line) => line.text);
    expect(overpetTexts).toContain(snap.bubble!.text);
  });
});

describe("failure streaks and recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Next day: module-level cooldowns/pulses from every earlier suite have
    // safely lapsed, and the failure streak counter is still untouched.
    vi.setSystemTime(new Date(2026, 6, 12, 9, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("escalates the third straight failure and celebrates the next win as a comeback", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    petShipResult("failure");
    let snap = getPetSnapshot();
    expect(PET_LINES["ship-failure"].map((l) => l.text)).toContain(snap.bubble!.text);

    vi.advanceTimersByTime(40_000);
    petShipResult("failure");
    vi.advanceTimersByTime(40_000);
    petShipResult("failure");
    snap = getPetSnapshot();
    expect(snap.bubble).not.toBeNull();
    expect(PET_LINES["error-streak"].map((l) => l.text)).toContain(snap.bubble!.text);

    // The win after the rough patch reads as a recovery, not a routine push.
    vi.advanceTimersByTime(40_000);
    petShipResult("push-success");
    snap = getPetSnapshot();
    expect(PET_LINES.comeback.map((l) => l.text)).toContain(snap.bubble!.text);

    // Streak reset: a lone failure is back to the per-failure line.
    vi.advanceTimersByTime(40_000);
    petShipResult("failure");
    snap = getPetSnapshot();
    expect(PET_LINES["ship-failure"].map((l) => l.text)).toContain(snap.bubble!.text);
  });
});

describe("session milestones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 12, 12, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("the fifth finished session gets a milestone line", () => {
    // Relies on no earlier suite in this file ingesting session:finished — the
    // module-level counter must sit at 0 when this test starts.
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    for (let i = 1; i <= 4; i++) {
      petIngestServerEvent({ type: "session:finished", id: `s${i}` } as never);
      vi.advanceTimersByTime(60_000);
    }
    petIngestServerEvent({ type: "session:finished", id: "s5" } as never);
    const snap = getPetSnapshot();
    expect(snap.bubble).not.toBeNull();
    const expected = PET_LINES["session-milestone"].map((line) =>
      typeof line.text === "function"
        ? line.text({ name: snap.name, level: snap.level, runningCount: 0, sessionsFinished: 5 })
        : line.text,
    );
    expect(expected).toContain(snap.bubble!.text);
  });
});

describe("workspace event reactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 12, 15, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("reacts to worktree, project, and diagram events", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    petIngestServerEvent({ type: "worktree:created", id: "w1", projectId: "p1" } as never);
    let snap = getPetSnapshot();
    expect(PET_LINES["worktree-created"].map((l) => l.text)).toContain(snap.bubble!.text);

    vi.advanceTimersByTime(60_000);
    petIngestServerEvent({ type: "project:created", id: "p2" } as never);
    snap = getPetSnapshot();
    expect(PET_LINES["project-created"].map((l) => l.text)).toContain(snap.bubble!.text);

    vi.advanceTimersByTime(60_000);
    petIngestServerEvent({ type: "diagram:show", id: "d1" } as never);
    snap = getPetSnapshot();
    expect(PET_LINES["diagram-show"].map((l) => l.text)).toContain(snap.bubble!.text);
  });
});
