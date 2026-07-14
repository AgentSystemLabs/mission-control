import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPetPersistentState,
  getPetSnapshot,
  isNightHour,
  MOOD_DEBOUNCE_MS,
  PET_MOVES_PER_MOOD,
  petGrabbed,
  petHydrate,
  petIngestServerEvent,
  petInteract,
  petMolt,
  petNoteUncommitted,
  petPulse,
  petSetAggregates,
  petSetEnabled,
  petSetHomeSide,
  petSetShipping,
  petSetSpecies,
  petSetStatsOpen,
  petShipResult,
  petStroke,
  petTossed,
  petUserActivity,
  resolvePetMood,
  type PetInputs,
} from "./pet-store";
import { PET_LINES } from "./pet-lines";
import { PET_MAX_LEVEL } from "~/shared/pet";

const NOW = 10_000_000;

function inputs(overrides: Partial<PetInputs> = {}): PetInputs {
  return {
    runningCount: 0,
    needsInputCount: 0,
    shippingActive: false,
    startleUntil: 0,
    celebrateUntil: 0,
    singUntil: 0,
    lastKeyAt: 0,
    lastActivityAt: NOW,
    hiddenSince: null,
    napUntil: 0,
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

  it("a commanded serenade sings over ambient work but yields to nap/startle/alert", () => {
    // "Pixel, sing" mid-session: agents still running, but the serenade shows.
    const singing = { singUntil: NOW + 6_000, runningCount: 2, shippingActive: true };
    expect(resolvePetMood(inputs(singing), NOW).mood).toBe("singing");
    // Deliberate but not urgent — a real interrupt still wins.
    expect(resolvePetMood(inputs({ ...singing, needsInputCount: 1 }), NOW).mood).toBe("alert");
    expect(resolvePetMood(inputs({ ...singing, startleUntil: NOW + 1_000 }), NOW).mood).toBe(
      "startled",
    );
    expect(resolvePetMood(inputs({ ...singing, napUntil: NOW + 60_000 }), NOW).mood).toBe(
      "sleeping",
    );
    // Once the song is over it resolves normally again.
    expect(resolvePetMood(inputs({ ...singing, singUntil: NOW - 1 }), NOW).mood).toBe("shipping");
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

  it("a commanded nap sleeps through work chatter — running, celebrating, watching", () => {
    // The exact churn that follows a "sleep" prompt: the agent responds
    // (running), the session finishes (celebrate pulse), keys were just hit.
    const napping = {
      napUntil: NOW + 60_000,
      runningCount: 2,
      celebrateUntil: NOW + 5_000,
      lastKeyAt: NOW,
      shippingActive: true,
    };
    expect(resolvePetMood(inputs(napping), NOW).mood).toBe("sleeping");
    // Only a blocked session or a startle interrupts the nap.
    expect(resolvePetMood(inputs({ ...napping, needsInputCount: 1 }), NOW).mood).toBe("alert");
    expect(resolvePetMood(inputs({ ...napping, startleUntil: NOW + 1_000 }), NOW).mood).toBe(
      "startled",
    );
    // An expired nap resolves normally again.
    expect(resolvePetMood(inputs({ ...napping, napUntil: NOW - 1 }), NOW).mood).toBe("shipping");
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

  it("answers to its own name over keyword flavor", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    const state = getPetPersistentState()!;
    petIngestServerEvent({
      type: "prompt:submitted",
      taskId: "t-name",
      projectId: "p1",
      // "fix" would otherwise route to prompt-fix; the name outranks it.
      snippet: `hey ${state.name}, fix the login crash`,
    } as never);

    const { bubble } = getPetSnapshot();
    expect(bubble).not.toBeNull();
    const nameLines = PET_LINES["name-mentioned"]
      .filter((line) => !line.species || line.species.includes(state.species))
      .map((line) =>
        typeof line.text === "function"
          ? line.text({
              name: state.name,
              level: state.level,
              prestige: state.prestige,
              runningCount: 0,
              sessionsFinished: 0,
              species: state.species,
              uncommittedCount: 0,
              favoriteProject: null,
              ageDays: 0,
              weekly: { sessions: 0, ships: 0, prs: 0, failures: 0 },
            })
          : line.text,
      );
    expect(nameLines).toContain(bubble!.text);
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

describe("agent:tool-used mid-run reaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A distinct, later clock than the other suites so any leaked bubble bucket
    // / pulse window from them has aged out of its sliding window.
    vi.setSystemTime(new Date(2026, 6, 11, 16, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  const linesFor = (trigger: "agent-working" | "agent-error", species: string) =>
    PET_LINES[trigger]
      .filter((line) => !line.species || line.species.includes(species as never))
      .map((line) => line.text as string);

  it("reacts to a neutral tool with an antic and a line", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000); // clear any leaked bucket/pulse from prior suites

    const state = getPetPersistentState()!;
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t1",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "neutral",
    } as never);

    const snap = getPetSnapshot();
    expect(snap.flourish).not.toBeNull();
    expect(snap.bubble).not.toBeNull();
    expect(linesFor("agent-working", state.species)).toContain(snap.bubble!.text);
  });

  it("startles and shows a concerned line on an error result", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    const state = getPetPersistentState()!;
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t1",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "error",
    } as never);

    const snap = getPetSnapshot();
    expect(snap.mood).toBe("startled");
    expect(linesFor("agent-error", state.species)).toContain(snap.bubble!.text);
  });

  it("does nothing when the pet is disabled", () => {
    petSetEnabled(false, true, false);
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t1",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "error",
    } as never);
    const snap = getPetSnapshot();
    expect(snap.enabled).toBe(false);
    expect(snap.bubble).toBeNull();
    expect(snap.flourish).toBeNull();
  });

  it("clears a stale needs-input alert when the same task runs a tool", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    // The agent asked a question — the pet posts an alert (an instant mood).
    petIngestServerEvent({
      type: "task:question",
      taskId: "t-ask",
      projectId: "p1",
      questionId: "q1",
      questions: [],
    } as never);
    expect(getPetSnapshot().mood).toBe("alert");

    // The question was answered (e.g. "Chat about this") without an
    // AskUserQuestion PostToolUse, so no task:question-cleared arrived. The
    // agent resumes and runs a tool — that alone must stand the alert down.
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t-ask",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "neutral",
    } as never);

    // Leaving the instant alert for a calm mood settles after the debounce.
    vi.advanceTimersByTime(MOOD_DEBOUNCE_MS + 100);
    expect(getPetSnapshot().mood).not.toBe("alert");
  });

  it("keeps alerting when a DIFFERENT task runs a tool", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    petIngestServerEvent({
      type: "task:question",
      taskId: "t-ask",
      projectId: "p1",
      questionId: "q1",
      questions: [],
    } as never);
    expect(getPetSnapshot().mood).toBe("alert");

    // A tool in an unrelated task must not clear another task's pending question.
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t-other",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "neutral",
    } as never);
    vi.advanceTimersByTime(MOOD_DEBOUNCE_MS + 100);
    expect(getPetSnapshot().mood).toBe("alert");

    // Clear the alert so this module-level state doesn't leak into later suites.
    petIngestServerEvent({
      type: "task:question-cleared",
      taskId: "t-ask",
      projectId: "p1",
    } as never);
  });

  it("speaks the classified line for a specific tool kind", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    // Further than the sibling tests' 700s: their startle pulses were stamped
    // at exactly +700s on this suite's shared clock and must have lapsed for
    // "celebrating" to win the mood race.
    vi.advanceTimersByTime(760_000);

    const state = getPetPersistentState()!;
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t1",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "success",
      kind: "commit",
    } as never);

    const snap = getPetSnapshot();
    // A win celebrates rather than startles…
    expect(snap.mood).toBe("celebrating");
    // …and the line comes from the commit pack, not the generic one.
    const commitLines = PET_LINES["tool-commit"]
      .filter((line) => !line.species || line.species.includes(state.species))
      .map((line) => line.text as string);
    expect(commitLines).toContain(snap.bubble!.text);
  });

  it("startles on a classified failure and speaks its specific line", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    const state = getPetPersistentState()!;
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t1",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "error",
      kind: "merge-conflict",
    } as never);

    const snap = getPetSnapshot();
    expect(snap.mood).toBe("startled");
    const conflictLines = PET_LINES["tool-merge-conflict"]
      .filter((line) => !line.species || line.species.includes(state.species))
      .map((line) => line.text as string);
    expect(conflictLines).toContain(snap.bubble!.text);
  });
});

describe("agent:remark — Claude speaks through the pet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A distinct, later clock so leaked cooldowns from other suites (and this
    // one's own 30s remark floor) have safely lapsed between tests.
    vi.setSystemTime(new Date(2026, 6, 12, 10, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("speaks Claude's line verbatim, preempting an open bubble", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    // Open a stock bubble first — the remark must replace it.
    petIngestServerEvent({
      type: "agent:tool-used",
      taskId: "t1",
      projectId: "p1",
      toolName: "Bash",
      sentiment: "neutral",
    } as never);
    expect(getPetSnapshot().bubble).not.toBeNull();

    petIngestServerEvent({
      type: "agent:remark",
      taskId: "t1",
      projectId: "p1",
      text: "the suite purrs",
    } as never);
    expect(getPetSnapshot().bubble!.text).toBe("the suite purrs");
  });

  it("never preempts a critical needs-input alert", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    // A session is blocked on the user — the pet raises a critical alert.
    petIngestServerEvent({
      type: "task:question",
      taskId: "t9",
      projectId: "p1",
    } as never);
    const alertBubble = getPetSnapshot().bubble;
    expect(alertBubble?.priority).toBe("critical");

    // Another session finishes and Claude sends a remark — it must NOT bury
    // the critical "needs input" alert (a finish line would be lost noise; the
    // alert is the one message the user must see).
    petIngestServerEvent({
      type: "agent:remark",
      taskId: "t8",
      projectId: "p1",
      text: "all done over here",
    } as never);
    const after = getPetSnapshot().bubble;
    expect(after!.priority).toBe("critical");
    expect(after!.text).toBe(alertBubble!.text);

    // Clear the alert so its tracked task id doesn't leak into later suites
    // (disabling the pet doesn't drop questionTaskIds).
    petIngestServerEvent({
      type: "task:question-cleared",
      taskId: "t9",
      projectId: "p1",
    } as never);
  });

  it("stays quiet when messages are off and rate-limits rapid remarks", () => {
    petHydrate(null);
    petSetEnabled(true, false, false);
    vi.advanceTimersByTime(700_000);
    petIngestServerEvent({
      type: "agent:remark",
      taskId: "t1",
      projectId: "p1",
      text: "muted",
    } as never);
    expect(getPetSnapshot().bubble).toBeNull();

    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(60_000);
    petIngestServerEvent({
      type: "agent:remark",
      taskId: "t1",
      projectId: "p1",
      text: "first",
    } as never);
    petIngestServerEvent({
      type: "agent:remark",
      taskId: "t2",
      projectId: "p1",
      text: "second",
    } as never);
    // The second remark landed inside the 30s floor — the first keeps the stage.
    expect(getPetSnapshot().bubble!.text).toBe("first");
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

    // The win after the rough patch reads as a recovery typed by what kept
    // failing (ships), not a routine push.
    vi.advanceTimersByTime(40_000);
    petShipResult("push-success");
    snap = getPetSnapshot();
    expect(PET_LINES["comeback-ship"].map((l) => l.text)).toContain(snap.bubble!.text);

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
        ? line.text({
            name: snap.name,
            level: snap.level,
            prestige: snap.prestige,
            runningCount: 0,
            sessionsFinished: 5,
            species: snap.species,
            uncommittedCount: 0,
            favoriteProject: null,
            ageDays: 0,
            weekly: { sessions: 0, ships: 0, prs: 0, failures: 0 },
          })
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

describe("error streak escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Next day again: earlier suites' cooldowns have lapsed and the streak
    // counter sits at 0 (the milestone suite's successes reset it).
    vi.setSystemTime(new Date(2026, 6, 13, 9, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("escalates at five, ten, and the 20+ void tier", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);
    const texts = (trigger: keyof typeof PET_LINES) => PET_LINES[trigger].map((l) => l.text);

    for (let i = 1; i <= 5; i++) {
      if (i > 1) vi.advanceTimersByTime(130_000);
      petShipResult("failure");
    }
    expect(texts("error-streak-5")).toContain(getPetSnapshot().bubble!.text);

    for (let i = 6; i <= 10; i++) {
      vi.advanceTimersByTime(130_000);
      petShipResult("failure");
    }
    expect(texts("error-streak-10")).toContain(getPetSnapshot().bubble!.text);

    for (let i = 11; i <= 20; i++) {
      vi.advanceTimersByTime(130_000);
      petShipResult("failure");
    }
    expect(texts("error-streak-20")).toContain(getPetSnapshot().bubble!.text);

    // The void tier keeps answering further failures (cooldown permitting).
    vi.advanceTimersByTime(130_000);
    petShipResult("failure");
    expect(texts("error-streak-20")).toContain(getPetSnapshot().bubble!.text);
  });
});

describe("typed comebacks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 10, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("a clean finish after interruptions reads as an interruption comeback", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    // Clear the losing streak the escalation suite left behind.
    petShipResult("push-success");
    vi.advanceTimersByTime(70_000);

    petSetAggregates({ running: 0, needsInput: 0, interrupted: 1 });
    vi.advanceTimersByTime(70_000);
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 2 });
    vi.advanceTimersByTime(70_000);
    petIngestServerEvent({ type: "session:finished", id: "cb1" } as never);
    const snap = getPetSnapshot();
    expect(PET_LINES["comeback-interrupted"].map((l) => l.text)).toContain(snap.bubble!.text);
  });
});

describe("context combos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-07-17 is a Friday.
    vi.setSystemTime(new Date(2026, 6, 17, 14, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("a friday push speaks the friday-push line", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    petSetShipping(true, "pushing");
    const snap = getPetSnapshot();
    expect(PET_LINES["friday-push"].map((l) => l.text)).toContain(snap.bubble!.text);
    petSetShipping(false, null);
  });

  it("a late-night commit speaks the night-commit line", () => {
    vi.setSystemTime(new Date(2026, 6, 17, 23, 30, 0));
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(30_000);

    petSetShipping(true, "committing");
    const snap = getPetSnapshot();
    expect(PET_LINES["night-commit"].map((l) => l.text)).toContain(snap.bubble!.text);
    petSetShipping(false, null);
  });
});

describe("work awareness + direct interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Later than every prior suite (module-level cooldowns leak), and a new
    // ISO week relative to their 2026-07-06 week — exercising the weekly
    // rollover on the first counter bump below.
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    petHydrate(null);
    petSetEnabled(true, true, false);
  });
  afterEach(() => {
    petSetHomeSide("right");
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  /** Resolve a pack to its candidate texts for the hydrated pet's species. */
  function packTexts(trigger: keyof typeof PET_LINES, ctx: Record<string, unknown>): string[] {
    const state = getPetPersistentState()!;
    return PET_LINES[trigger]
      .filter((line) => !line.species || line.species.includes(state.species))
      .map((line) =>
        typeof line.text === "function"
          ? line.text({
              name: state.name,
              level: state.level,
              prestige: state.prestige,
              runningCount: 0,
              sessionsFinished: 0,
              species: state.species,
              uncommittedCount: 0,
              favoriteProject: null,
              ageDays: 0,
              weekly: { sessions: 0, ships: 0, prs: 0, failures: 0 },
              ...ctx,
            })
          : line.text,
      );
  }

  it("a finished session lands in lifetime stats, the rolled-over week, and project XP", () => {
    vi.advanceTimersByTime(60_000);

    const before = getPetPersistentState()!;
    petIngestServerEvent({
      type: "session:finished",
      id: "aw-1",
      projectId: "proj-alpha",
      projectName: "Alpha",
    } as never);
    const after = getPetPersistentState()!;
    expect(after.stats.sessions).toBe(before.stats.sessions + 1);
    // New week relative to the earlier suites' bumps — the window reset.
    expect(after.weekly.weekStart).toBe(new Date(2026, 6, 20).getTime());
    expect(after.weekly.sessions).toBe(1);
    expect(after.projectXp["proj-alpha"]).toEqual({
      name: "Alpha",
      xp: (before.projectXp["proj-alpha"]?.xp ?? 0) + 5,
    });
  });

  it("ship outcomes update ships/failures and track the worst streak", () => {
    vi.advanceTimersByTime(60_000);
    const before = getPetPersistentState()!;
    petShipResult("failure");
    const mid = getPetPersistentState()!;
    expect(mid.stats.failures).toBe(before.stats.failures + 1);
    expect(mid.weekly.failures).toBe(before.weekly.failures + 1);
    expect(mid.stats.worstStreak).toBeGreaterThanOrEqual(1);
    petShipResult("push-success");
    const after = getPetPersistentState()!;
    expect(after.stats.ships).toBe(mid.stats.ships + 1);
    expect(after.weekly.ships).toBe(mid.weekly.ships + 1);
  });

  it("a dance command by name dances instead of the plain name answer", () => {
    vi.advanceTimersByTime(60_000);
    const state = getPetPersistentState()!;
    petIngestServerEvent({
      type: "prompt:submitted",
      taskId: "t-dance",
      projectId: "p1",
      snippet: `${state.name}, dance for us!`,
    } as never);
    const snap = getPetSnapshot();
    expect(snap.flourish?.kind).toBe("dance");
    expect(packTexts("command-dance", {})).toContain(snap.bubble!.text);
  });

  it("a stats command opens the stats card", () => {
    vi.advanceTimersByTime(60_000);
    const state = getPetPersistentState()!;
    expect(getPetSnapshot().statsOpen).toBe(false);
    petIngestServerEvent({
      type: "prompt:submitted",
      taskId: "t-stats",
      projectId: "p1",
      snippet: `${state.name} show me your stats`,
    } as never);
    expect(getPetSnapshot().statsOpen).toBe(true);
    petSetStatsOpen(false);
    expect(getPetSnapshot().statsOpen).toBe(false);
  });

  it("a toss lands the pet where dropped, dizzy, then it walks home after the daze", () => {
    vi.advanceTimersByTime(60_000);
    petTossed(500);
    const snap = getPetSnapshot();
    expect(snap.wander).toMatchObject({ x: 500, walking: false });
    expect(snap.flourish?.kind).toBe("spin");
    expect(packTexts("tossed", {})).toContain(snap.bubble!.text);
    // The startle's walk-home is suppressed while dazed; after the rest the
    // pet heads back on its own.
    vi.advanceTimersByTime(2_600);
    const rested = getPetSnapshot();
    expect(rested.wander.x).toBe(0);
    expect(rested.wander.walking).toBe(true);
  });

  it("flipping the home corner snaps the pet home and updates the snapshot", () => {
    petTossed(200);
    expect(getPetSnapshot().wander.x).toBe(200);
    petSetHomeSide("left");
    expect(getPetSnapshot()).toMatchObject({
      homeSide: "left",
      wander: { x: 0, walking: false },
    });
    petSetHomeSide("right");
    expect(getPetSnapshot().homeSide).toBe("right");
  });

  it("a grab pins the pet at its visual spot and freezes walking until put down", () => {
    vi.advanceTimersByTime(60_000);
    petTossed(400);
    // Daze over — it starts walking home (store target 0, transition running).
    vi.advanceTimersByTime(2_600);
    expect(getPetSnapshot().wander).toMatchObject({ x: 0, walking: true });
    // Caught mid-walk at its measured visual position: pinned, not the target.
    petGrabbed(250);
    expect(getPetSnapshot().wander).toMatchObject({ x: 250, walking: false });
    // While held nothing may move it — not behavior ticks, not stale timers.
    vi.advanceTimersByTime(20_000);
    expect(getPetSnapshot().wander).toMatchObject({ x: 250, walking: false });
    // Putting it down releases the hold and lands it where dropped.
    petTossed(120);
    expect(getPetSnapshot().wander).toMatchObject({ x: 120, walking: false });
  });

  it("nudges about a big uncommitted pile, but not a small one", () => {
    vi.advanceTimersByTime(60_000 * 10);
    expect(getPetSnapshot().bubble).toBeNull();
    petNoteUncommitted(3);
    expect(getPetSnapshot().bubble).toBeNull();
    petNoteUncommitted(25);
    const snap = getPetSnapshot();
    expect(packTexts("uncommitted-pile", { uncommittedCount: 25 })).toContain(snap.bubble!.text);
  });

  it("getting spam-clicked dizzy drifts snark upward", () => {
    vi.advanceTimersByTime(60_000 * 10);
    const before = getPetPersistentState()!;
    for (let i = 0; i < 5; i++) petInteract();
    const after = getPetPersistentState()!;
    expect(after.personalityDrift.snark).toBeCloseTo(before.personalityDrift.snark + 0.1, 5);
    // The base never moves; only drift does.
    expect(after.personalityBase).toEqual(before.personalityBase);
  });
});

describe("level progression: evolve + molt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Later than every prior suite — module-level cooldowns and the XP total
    // leak across the file, so this suite grinds from wherever XP stands.
    vi.setSystemTime(new Date(2026, 6, 28, 12, 0, 0));
    petHydrate(null);
    petSetEnabled(true, true, false);
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  /** PR-created grants (+15) with the bubble aged out between each. */
  function grindTo(targetXp: number): void {
    while (getPetPersistentState()!.xp + 15 < targetXp) {
      petShipResult("pr-created");
      vi.advanceTimersByTime(30_000);
    }
  }

  /** Resolve a pack to candidate texts for the current pet. */
  function packTexts(trigger: keyof typeof PET_LINES): string[] {
    const state = getPetPersistentState()!;
    return PET_LINES[trigger]
      .filter((line) => !line.species || line.species.includes(state.species))
      .map((line) =>
        typeof line.text === "function"
          ? line.text({
              name: state.name,
              level: state.level,
              prestige: state.prestige,
              runningCount: 0,
              sessionsFinished: 0,
              species: state.species,
              uncommittedCount: 0,
              favoriteProject: null,
              ageDays: 0,
              weekly: { sessions: 0, ships: 0, prs: 0, failures: 0 },
            })
          : line.text,
      );
  }

  it("crossing an evolution threshold announces the new gear, not the plain level-up", () => {
    vi.advanceTimersByTime(60_000 * 10);
    const thresholds = [
      { level: 3, xp: 150 },
      { level: 5, xp: 500 },
      { level: 8, xp: 1_700 },
      { level: 10, xp: 3_000 },
    ];
    const target = thresholds.find((t) => t.xp > getPetPersistentState()!.xp);
    expect(target).toBeDefined();
    grindTo(target!.xp);
    // The crossing grant: grantXp runs before the pr-created line, so the
    // evolve announcement wins the bubble.
    petShipResult("pr-created");
    const state = getPetPersistentState()!;
    expect(state.level).toBe(target!.level);
    expect(packTexts("evolve")).toContain(getPetSnapshot().bubble!.text);
  });

  it("molting at the cap resets xp/level, keeps the life lived, and unlocks ember", () => {
    vi.advanceTimersByTime(60_000 * 10);
    grindTo(3_000);
    petShipResult("pr-created");
    vi.advanceTimersByTime(30_000);
    const before = getPetPersistentState()!;
    expect(before.level).toBe(PET_MAX_LEVEL);

    // The prestige species stays locked until the first molt completes.
    petSetSpecies("ember");
    expect(getPetPersistentState()!.species).toBe(before.species);

    expect(petMolt()).toBe(true);
    const after = getPetPersistentState()!;
    expect(after).toMatchObject({ xp: 0, level: 1, prestige: before.prestige + 1 });
    expect(after.stats).toEqual(before.stats);
    expect(after.personalityBase).toEqual(before.personalityBase);
    expect(after.personalityDrift).toEqual(before.personalityDrift);
    expect(after.projectXp).toEqual(before.projectXp);
    expect(after.createdAt).toBe(before.createdAt);
    expect(packTexts("molt")).toContain(getPetSnapshot().bubble!.text);

    // Below the cap there is nothing to molt.
    expect(petMolt()).toBe(false);

    // The molt earned the ember form.
    petSetSpecies("ember");
    expect(getPetPersistentState()!.species).toBe("ember");
  });
});

describe("stale question reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Later than every earlier suite — the module-level rate limiter carries
    // real timestamps across suites, so the clock must only move forward.
    vi.setSystemTime(new Date(2026, 6, 29, 10, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("clears a question whose cleared/deleted event never arrived once aggregates repeatedly say zero", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    petIngestServerEvent({
      type: "task:question",
      taskId: "t-lost",
      projectId: "p1",
    } as never);
    expect(getPetSnapshot().mood).toBe("alert");

    // One or two zero reports must NOT cull it — aggregates can lag a fresh
    // question by a refetch.
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    expect(getPetSnapshot().mood).toBe("alert");

    // The third consecutive authoritative zero means the id is stale.
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    vi.advanceTimersByTime(MOOD_DEBOUNCE_MS + 100);
    expect(getPetSnapshot().mood).not.toBe("alert");
    expect(getPetSnapshot().alert).toBeNull();
  });

  it("a non-zero report resets the stale counter", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    petIngestServerEvent({
      type: "task:question",
      taskId: "t-live",
      projectId: "p1",
    } as never);
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    // The aggregates catch up — the question is real after all.
    petSetAggregates({ running: 0, needsInput: 1, interrupted: 0 });
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    expect(getPetSnapshot().mood).toBe("alert");

    // Clean up module-level state for later suites.
    petIngestServerEvent({ type: "task:question-cleared", taskId: "t-live" } as never);
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
  });

  it("a fresh question event restarts the stale count", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    petIngestServerEvent({ type: "task:question", taskId: "t-a", projectId: "p1" } as never);
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    petIngestServerEvent({ type: "task:question", taskId: "t-b", projectId: "p1" } as never);
    // Two zero reports predate t-b; it must get a full window of its own.
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
    expect(getPetSnapshot().mood).toBe("alert");

    petIngestServerEvent({ type: "task:question-cleared", taskId: "t-a" } as never);
    petIngestServerEvent({ type: "task:question-cleared", taskId: "t-b" } as never);
    petSetAggregates({ running: 0, needsInput: 0, interrupted: 0 });
  });
});

describe("molt announcement preempts a visible bubble", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 30, 15, 0, 0));
  });
  afterEach(() => {
    petSetEnabled(false, true, false);
    vi.useRealTimers();
  });

  it("the molt line replaces whatever bubble is still up instead of being dropped", () => {
    petHydrate(null);
    petSetEnabled(true, true, false);
    vi.advanceTimersByTime(700_000);

    // Reach the cap, aging each PR bubble out along the way.
    while (getPetPersistentState()!.xp < 3_000) {
      petShipResult("pr-created");
      vi.advanceTimersByTime(30_000);
    }
    expect(getPetPersistentState()!.level).toBe(PET_MAX_LEVEL);
    vi.advanceTimersByTime(600_000); // clear cooldown/bucket residue

    // Put a fresh bubble on screen (petting bypasses a full bucket)…
    petInteract();
    const before = getPetSnapshot().bubble;
    expect(before).not.toBeNull();

    // …and molt while it is still visible. The announcement of the pet's
    // rarest event must preempt, not silently vanish behind the petting line.
    expect(petMolt()).toBe(true);
    const bubble = getPetSnapshot().bubble;
    expect(bubble).not.toBeNull();
    expect(bubble!.id).not.toBe(before!.id);
  });
});
