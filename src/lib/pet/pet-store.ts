import { useSyncExternalStore } from "react";
import type { ServerEvent } from "~/lib/use-events";
import {
  createDefaultPetState,
  DEFAULT_PET_SIZE,
  DEFAULT_PET_SPECIES,
  levelForXp,
  type PetPersistentState,
  type PetSizeId,
  type PetSpeciesId,
} from "~/shared/pet";
import { createListenerSet } from "../listener-set";
import { playPetChirp } from "./pet-sounds";
import {
  bubbleDurationMs,
  classifyPromptSnippet,
  comboTrigger,
  createRateLimiter,
  pickLine,
  TRIGGER_PRIORITY,
  type PetMessagePriority,
  type PetTrigger,
} from "./pet-messages";

/**
 * Mission Pet state machine. A module-level external store (same idiom as
 * agent-question-store) that folds every real activity signal — SSE events,
 * aggregate task counts, ship operations, user input — into one mood plus an
 * optional speech bubble. The pet has no artificial care stats: if it looks
 * busy, your agents are busy.
 */

export type PetMood =
  | "sleeping"
  | "idle"
  | "watching"
  | "working"
  | "alert"
  | "celebrating"
  | "shipping"
  | "startled";

export type PetBubble = { id: number; text: string; priority: PetMessagePriority };

/** Idle wandering along the bottom strip; x is px left of the home corner. */
export type PetWander = {
  x: number;
  walking: boolean;
  /** CSS transition duration for the current move. */
  durationMs: number;
  facing: 1 | -1;
};

/** One-shot antics (idle antics + petting reactions); keyed by id so the
 * animation restarts each time. */
export type PetFlourish = {
  id: number;
  kind:
    | "hop"
    | "stretch"
    | "spin"
    | "flip"
    | "tada"
    | "bound"
    | "dance"
    | "jump"
    | "shimmy"
    | "pounce";
};

/** Upbeat subset the pet plays when you fire a prompt — it perks up and hops. */
const PET_EXCITED_REACTIONS: readonly PetFlourish["kind"][] = [
  "bound",
  "pounce",
  "hop",
  "shimmy",
  "jump",
  "dance",
];

/** Pool a click/pet draws its one-shot reaction from, never twice in a row. */
const PET_REACTIONS: readonly PetFlourish["kind"][] = [
  "hop",
  "stretch",
  "spin",
  "flip",
  "tada",
  "bound",
  "dance",
  "jump",
  "shimmy",
  "pounce",
];

/** Each mood has this many looping animation variants in CSS (data-move). */
export const PET_MOVES_PER_MOOD = 10;

export type PetSnapshot = {
  enabled: boolean;
  mood: PetMood;
  /** Which of the mood's animation variants is playing (0..PET_MOVES_PER_MOOD-1). */
  move: number;
  /** True between 22:00 and 06:00 — a visual modifier, not a mood. */
  night: boolean;
  /** Working animation speed, scaled by how many agents run in parallel. */
  intensity: 1 | 2 | 3;
  bubble: PetBubble | null;
  /** Most recent session waiting on the user; click-through target. */
  alert: { taskId: string; projectId: string } | null;
  name: string;
  species: PetSpeciesId;
  size: PetSizeId;
  xp: number;
  level: number;
  /** Increments on each petting; keys the hearts burst animation. */
  heartsBurstId: number;
  wander: PetWander;
  flourish: PetFlourish | null;
};

export type PetInputs = {
  runningCount: number;
  needsInputCount: number;
  shippingActive: boolean;
  startleUntil: number;
  celebrateUntil: number;
  lastKeyAt: number;
  lastActivityAt: number;
  hiddenSince: number | null;
};

export const MOOD_DEBOUNCE_MS = 1_200;
const WATCHING_WINDOW_MS = 8_000;
const IDLE_AFTER_MS = 5 * 60_000;
const HIDDEN_SLEEP_AFTER_MS = 60_000;
const CELEBRATE_MS = 5_000;
const STARTLE_MS = 3_000;
const LONG_RUN_MS = 20 * 60_000;
const PETTING_XP_COOLDOWN_MS = 60_000;
const CLOCK_TICK_MS = 30_000;
/** This many clicks inside the window makes the pet dizzy instead of happy. */
const DIZZY_CLICK_COUNT = 5;
const DIZZY_WINDOW_MS = 2_500;
/** Hold-to-pet murmurs on this throttle, not on every 600ms stroke tick. */
const STROKE_CHIRP_MS = 1_500;

/** How far left of its home corner the pet may wander, in px. */
export const PET_WANDER_RANGE_PX = 300;
const WALK_SPEED_PX_PER_S = 45;
const HOME_SPEED_PX_PER_S = 120;
const BEHAVIOR_TICK_MS = 6_500;
const FLOURISH_MS = 1_400;

/** Consecutive failures (ships, interruptions) before the pet calls a streak. */
const ERROR_STREAK_THRESHOLD = 3;
/** A win after this many straight failures reads as a comeback. */
const COMEBACK_MIN_STREAK = 2;

const XP_SESSION_FINISHED = 5;
const XP_SESSION_FINISHED_LONG = 8;
const XP_SHIP_SUCCESS = 10;
const XP_PR_CREATED = 15;
const XP_MEMORY_LEARNED = 3;
const XP_PETTING = 1;

/**
 * Pure mood resolution — first matching row wins. Rows 1–4 (urgent/pulse
 * moods) commit instantly; the caller debounces the calmer rows so the pet
 * doesn't flicker between working/idle on rapid status churn.
 */
export function resolvePetMood(
  inputs: PetInputs,
  now: number,
): { mood: PetMood; intensity: 1 | 2 | 3 } {
  const intensity: 1 | 2 | 3 = inputs.runningCount >= 4 ? 3 : inputs.runningCount >= 2 ? 2 : 1;
  if (inputs.needsInputCount > 0) return { mood: "alert", intensity };
  if (now < inputs.startleUntil) return { mood: "startled", intensity };
  if (inputs.shippingActive) return { mood: "shipping", intensity };
  if (now < inputs.celebrateUntil) return { mood: "celebrating", intensity };
  if (inputs.runningCount > 0) return { mood: "working", intensity };
  if (now - inputs.lastKeyAt < WATCHING_WINDOW_MS) return { mood: "watching", intensity };
  if (
    now - inputs.lastActivityAt > IDLE_AFTER_MS ||
    (inputs.hiddenSince !== null && now - inputs.hiddenSince > HIDDEN_SLEEP_AFTER_MS)
  ) {
    return { mood: "sleeping", intensity };
  }
  return { mood: "idle", intensity };
}

const INSTANT_MOODS: ReadonlySet<PetMood> = new Set([
  "alert",
  "startled",
  "shipping",
  "celebrating",
]);

export function isNightHour(now: number): boolean {
  const hour = new Date(now).getHours();
  return hour >= 22 || hour < 6;
}

// ---------------------------------------------------------------------------
// Store internals
// ---------------------------------------------------------------------------

const { subscribe, notify } = createListenerSet();
const { subscribe: subscribePersistenceListeners, notify: notifyPersistence } =
  createListenerSet();

let enabled = false;
let messagesEnabled = true;
let soundsEnabled = false;
let hydrated = false;
// True when this boot rolled a brand-new pet — the greeting becomes a hatch.
let freshlyHatched = false;
let persistent: PetPersistentState | null = null;

const inputs: PetInputs = {
  runningCount: 0,
  needsInputCount: 0,
  shippingActive: false,
  startleUntil: 0,
  celebrateUntil: 0,
  lastKeyAt: 0,
  lastActivityAt: Date.now(),
  hiddenSince: null,
};

let mood: PetMood = "idle";
let move = 0;
let intensity: 1 | 2 | 3 = 1;
let pendingMood: PetMood | null = null;
let pendingSince = 0;
let bubble: PetBubble | null = null;
let bubbleId = 0;
let alert: { taskId: string; projectId: string } | null = null;
let heartsBurstId = 0;
let lastPettingXpAt = 0;
let recentPetClicks: number[] = [];
let lastStrokeChirpAt = 0;
let wander: PetWander = { x: 0, walking: false, durationMs: 0, facing: 1 };
let flourish: PetFlourish | null = null;
let flourishId = 0;

// Aggregate counts from useProjects can lag the SSE stream by a refetch, so
// question events maintain their own live set; needs-input uses whichever is
// larger.
const questionTaskIds = new Set<string>();
let aggregateNeedsInput = 0;
let aggregateInterrupted = 0;
// prompt:submitted timestamps, so session:finished can tell a long run.
const promptStartedAt = new Map<string, number>();
// Consecutive failures (ship errors, interruptions) with no success between —
// feeds the error-streak / comeback lines. Resets on any win.
let failureStreak = 0;
// What kept failing, so the eventual comeback line can name the struggle.
let lastFailureKind: "ship" | "interrupted" | null = null;
// Sessions finished since app boot; milestones (5, 10, 20…) get their own line.
let sessionsFinishedCount = 0;

function isSessionMilestone(count: number): boolean {
  return count === 5 || (count >= 10 && count % 10 === 0);
}

/**
 * Note a failure; returns the trigger for it. Streak escalation fires at the
 * exact counts 3, 5, and 10 — between tiers the per-failure line returns so
 * the joke doesn't repeat — then stays in the 20+ void tier (its cooldown
 * throttles the repeats).
 */
function noteFailure(perFailureTrigger: PetTrigger): PetTrigger {
  failureStreak += 1;
  lastFailureKind = perFailureTrigger === "ship-failure" ? "ship" : "interrupted";
  if (failureStreak >= 20) return "error-streak-20";
  if (failureStreak === 10) return "error-streak-10";
  if (failureStreak === 5) return "error-streak-5";
  if (failureStreak === ERROR_STREAK_THRESHOLD) return "error-streak";
  return perFailureTrigger;
}

/** Note a success; when it ends a losing streak, returns the comeback trigger
 * typed by what had been failing (null for a routine win). */
function noteSuccess(): PetTrigger | null {
  const comeback = failureStreak >= COMEBACK_MIN_STREAK;
  const kind = lastFailureKind;
  failureStreak = 0;
  lastFailureKind = null;
  if (!comeback) return null;
  if (kind === "ship") return "comeback-ship";
  if (kind === "interrupted") return "comeback-interrupted";
  return "comeback";
}

// Resolve Date.now at call time, not module load, so the limiter follows the
// same (possibly faked) clock as every other timer in this store.
const limiter = createRateLimiter(() => Date.now());
let levelUpCallback: ((level: number) => void) | null = null;

let snapshot: PetSnapshot = buildSnapshot();

function buildSnapshot(): PetSnapshot {
  return {
    enabled,
    mood,
    move,
    night: isNightHour(Date.now()),
    intensity,
    bubble,
    alert,
    name: persistent?.name ?? "",
    species: persistent?.species ?? DEFAULT_PET_SPECIES,
    size: persistent?.size ?? DEFAULT_PET_SIZE,
    xp: persistent?.xp ?? 0,
    level: persistent?.level ?? 1,
    heartsBurstId,
    wander,
    flourish,
  };
}

function invalidate(): void {
  snapshot = buildSnapshot();
  notify();
}

// --- timers (renderer only; every setter goes through these guards) ---------

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let behaviorTimer: ReturnType<typeof setInterval> | null = null;
let arriveTimer: ReturnType<typeof setTimeout> | null = null;
let flourishTimer: ReturnType<typeof setTimeout> | null = null;

function ensureClock(): void {
  if (clockTimer !== null || typeof window === "undefined") return;
  // Low-frequency tick that catches slow transitions with no triggering
  // event: drifting into idle/sleep and the night flag flipping.
  clockTimer = setInterval(() => {
    if (!enabled) return;
    recompute();
    invalidate();
  }, CLOCK_TICK_MS);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Walk to `target` px left of home. The widget renders it as a CSS transition. */
function walkTo(target: number, speedPxPerS: number): void {
  const clamped = Math.min(PET_WANDER_RANGE_PX, Math.max(0, Math.round(target)));
  const dist = Math.abs(clamped - wander.x);
  if (dist < 12) return;
  const durationMs = (dist / speedPxPerS) * 1000;
  wander = {
    x: clamped,
    walking: true,
    durationMs,
    // Increasing x = heading away from the home corner (leftward).
    facing: clamped > wander.x ? -1 : 1,
  };
  if (arriveTimer) clearTimeout(arriveTimer);
  arriveTimer = setTimeout(() => {
    arriveTimer = null;
    wander = { ...wander, walking: false, durationMs: 0 };
    invalidate();
  }, durationMs + 30);
  invalidate();
}

function walkHome(): void {
  if (wander.x === 0 && !wander.walking) return;
  walkTo(0, HOME_SPEED_PX_PER_S);
}

/** Pick a fresh animation variant for the current mood — never the same twice. */
function rollMove(): void {
  const next = Math.floor(Math.random() * (PET_MOVES_PER_MOOD - 1));
  move = next >= move ? next + 1 : next;
}

let lastReactionIdx = 0;

/** Random petting reaction, never repeating the previous one. */
function pickReaction(): PetFlourish["kind"] {
  const next = Math.floor(Math.random() * (PET_REACTIONS.length - 1));
  lastReactionIdx = next >= lastReactionIdx ? next + 1 : next;
  return PET_REACTIONS[lastReactionIdx];
}

let lastExcitedIdx = 0;

/** Random upbeat reaction for a prompt send, never repeating the previous one. */
function pickExcitedReaction(): PetFlourish["kind"] {
  const next = Math.floor(Math.random() * (PET_EXCITED_REACTIONS.length - 1));
  lastExcitedIdx = next >= lastExcitedIdx ? next + 1 : next;
  return PET_EXCITED_REACTIONS[lastExcitedIdx];
}

function doFlourish(kind: PetFlourish["kind"]): void {
  flourish = { id: ++flourishId, kind };
  if (flourishTimer) clearTimeout(flourishTimer);
  flourishTimer = setTimeout(() => {
    flourishTimer = null;
    flourish = null;
    invalidate();
  }, FLOURISH_MS);
  invalidate();
}

function ensureBehaviorLoop(): void {
  if (behaviorTimer !== null || typeof window === "undefined") return;
  // Autonomous idle antics: stroll the bottom strip, hop, stretch. Anything
  // more important than idling sends the pet home so status stays glanceable
  // in the corner.
  behaviorTimer = setInterval(() => {
    if (!enabled || prefersReducedMotion()) return;
    // Whatever the mood, occasionally switch to another of its move variants
    // so the pet doesn't loop one animation forever.
    if (Math.random() < 0.45) {
      rollMove();
      invalidate();
    }
    if (mood !== "idle") {
      walkHome();
      return;
    }
    const roll = Math.random();
    if (roll < 0.45) walkTo(Math.random() * PET_WANDER_RANGE_PX, WALK_SPEED_PX_PER_S);
    else if (roll < 0.6) doFlourish("hop");
    else if (roll < 0.72) doFlourish("stretch");
  }, BEHAVIOR_TICK_MS);
}

function recompute(): void {
  if (!enabled) return;
  const now = Date.now();
  inputs.needsInputCount = Math.max(aggregateNeedsInput, questionTaskIds.size);
  const candidate = resolvePetMood(inputs, now);

  if (candidate.mood === mood) {
    pendingMood = null;
    if (candidate.intensity !== intensity) {
      intensity = candidate.intensity;
      invalidate();
    }
    schedulePulseExpiry(now);
    return;
  }

  if (INSTANT_MOODS.has(candidate.mood)) {
    pendingMood = null;
    commitMood(candidate);
    schedulePulseExpiry(now);
    return;
  }

  // Calm moods debounce: the candidate must hold for MOOD_DEBOUNCE_MS.
  if (pendingMood !== candidate.mood) {
    pendingMood = candidate.mood;
    pendingSince = now;
  } else if (now - pendingSince >= MOOD_DEBOUNCE_MS) {
    pendingMood = null;
    commitMood(candidate);
    return;
  }
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    recompute();
  }, MOOD_DEBOUNCE_MS + 20);
}

function commitMood(next: { mood: PetMood; intensity: 1 | 2 | 3 }): void {
  mood = next.mood;
  intensity = next.intensity;
  // Every mood change enters on a fresh variant of that mood's move set.
  rollMove();
  // Real activity (or bedtime) interrupts the stroll — hurry back to the corner.
  if (mood !== "idle") walkHome();
  // Watching decays with no further event; re-check just after its window.
  if (watchTimer) clearTimeout(watchTimer);
  if (mood === "watching" && typeof window !== "undefined") {
    watchTimer = setTimeout(() => {
      watchTimer = null;
      recompute();
    }, WATCHING_WINDOW_MS + 50);
  }
  invalidate();
}

function schedulePulseExpiry(now: number): void {
  const until = Math.max(inputs.startleUntil, inputs.celebrateUntil);
  if (until <= now || typeof window === "undefined") return;
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    pulseTimer = null;
    recompute();
  }, until - now + 20);
}

function say(trigger: PetTrigger, opts?: { key?: string }): boolean {
  if (!enabled || !messagesEnabled || !persistent) return false;
  const priority = TRIGGER_PRIORITY[trigger];
  // A visible bubble blocks new lines; only critical preempts it.
  if (bubble && priority !== "critical") return false;
  if (!limiter.allow(trigger, opts?.key)) return false;
  const text = pickLine(trigger, persistent.personality, {
    name: persistent.name,
    level: persistent.level,
    runningCount: inputs.runningCount,
    sessionsFinished: sessionsFinishedCount,
    species: persistent.species,
  });
  if (!text) return false;
  bubble = { id: ++bubbleId, text, priority };
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null;
    bubble = null;
    invalidate();
  }, bubbleDurationMs(text));
  invalidate();
  return true;
}

/** Say `base`, upgraded to its context combo (2am commit, friday push…) when
 * the clock agrees and the combo's own cooldown hasn't spent it yet. */
function sayWithCombo(base: PetTrigger): void {
  const combo = comboTrigger(base, new Date());
  if (combo && say(combo)) return;
  say(base);
}

/** The pet's voice, in its own species' timbre; gated by the sounds setting. */
function chirp(kind: "pet" | "dizzy" = "pet"): void {
  if (!soundsEnabled) return;
  playPetChirp(persistent?.species ?? DEFAULT_PET_SPECIES, kind);
}

function grantXp(amount: number): void {
  if (!persistent) return;
  const xp = persistent.xp + amount;
  const level = levelForXp(xp);
  const leveledUp = level > persistent.level;
  persistent = { ...persistent, xp, level };
  if (leveledUp) {
    say("level-up");
    levelUpCallback?.(level);
  }
  notifyPersistence();
  invalidate();
}

// ---------------------------------------------------------------------------
// Public API (imperative inputs, called by use-pet-controller + the widget)
// ---------------------------------------------------------------------------

export function usePetSnapshot(): PetSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function getPetSnapshot(): PetSnapshot {
  return snapshot;
}

export function petSetEnabled(
  nextEnabled: boolean,
  nextMessagesEnabled: boolean,
  nextSoundsEnabled: boolean,
): void {
  messagesEnabled = nextMessagesEnabled;
  soundsEnabled = nextSoundsEnabled;
  if (enabled === nextEnabled) return;
  enabled = nextEnabled;
  if (enabled) {
    inputs.lastActivityAt = Date.now();
    ensureClock();
    ensureBehaviorLoop();
    recompute();
  } else {
    if (bubble) {
      bubble = null;
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    wander = { x: 0, walking: false, durationMs: 0, facing: 1 };
    flourish = null;
  }
  invalidate();
}

export function petSoundsOn(): boolean {
  return soundsEnabled;
}

/** One-shot: adopt the persisted identity, rolling a fresh one if absent. */
export function petHydrate(state: PetPersistentState | null): void {
  if (hydrated) return;
  hydrated = true;
  freshlyHatched = !state;
  persistent = state ?? createDefaultPetState();
  // A fresh roll must reach the server even before any XP accrues.
  if (!state) notifyPersistence();
  invalidate();
}

export function getPetPersistentState(): PetPersistentState | null {
  return persistent;
}

export function petRename(name: string): void {
  if (!persistent) return;
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed || trimmed === persistent.name) return;
  persistent = { ...persistent, name: trimmed };
  notifyPersistence();
  invalidate();
}

export function petSetSpecies(species: PetSpeciesId): void {
  if (!persistent || persistent.species === species) return;
  persistent = { ...persistent, species };
  notifyPersistence();
  invalidate();
}

export function petSetSize(size: PetSizeId): void {
  if (!persistent || persistent.size === size) return;
  persistent = { ...persistent, size };
  notifyPersistence();
  invalidate();
}

/** Fires on every xp/name/personality change; the controller debounces saves. */
export function subscribePetPersistence(listener: () => void): () => void {
  return subscribePersistenceListeners(listener);
}

export function onPetLevelUp(cb: (level: number) => void): () => void {
  levelUpCallback = cb;
  return () => {
    if (levelUpCallback === cb) levelUpCallback = null;
  };
}

/** Fold one SSE event. Fields are untrusted — narrow before use. */
export function petIngestServerEvent(event: ServerEvent): void {
  if (!enabled) return;
  switch (event.type) {
    case "task:question": {
      const taskId = typeof event.taskId === "string" ? event.taskId : "";
      const projectId = typeof event.projectId === "string" ? event.projectId : "";
      if (!taskId || !projectId) return;
      questionTaskIds.add(taskId);
      alert = { taskId, projectId };
      recompute();
      say("needs-input", { key: taskId });
      invalidate();
      return;
    }
    case "task:question-cleared":
    case "task:deleted": {
      const taskId =
        typeof event.taskId === "string"
          ? event.taskId
          : typeof event.id === "string"
            ? event.id
            : "";
      if (!taskId) return;
      questionTaskIds.delete(taskId);
      if (alert?.taskId === taskId) alert = null;
      promptStartedAt.delete(taskId);
      recompute();
      invalidate();
      return;
    }
    case "session:finished": {
      const taskId = typeof event.id === "string" ? event.id : "";
      const startedAt = taskId ? promptStartedAt.get(taskId) : undefined;
      if (taskId) promptStartedAt.delete(taskId);
      const longRun = startedAt !== undefined && Date.now() - startedAt > LONG_RUN_MS;
      sessionsFinishedCount += 1;
      const comeback = noteSuccess();
      petPulse("celebrate");
      // One bubble per finish — the rarest story wins: ending a losing streak
      // beats a count milestone beats the routine line. Speak before granting
      // XP so a level-up ding can't steal the finish's story.
      if (comeback) say(comeback);
      else if (isSessionMilestone(sessionsFinishedCount)) say("session-milestone");
      else say(longRun ? "session-finished-long" : "session-finished");
      grantXp(longRun ? XP_SESSION_FINISHED_LONG : XP_SESSION_FINISHED);
      return;
    }
    case "prompt:submitted": {
      const taskId = typeof event.taskId === "string" ? event.taskId : "";
      const snippet = typeof event.snippet === "string" ? event.snippet : "";
      const now = Date.now();
      if (taskId) promptStartedAt.set(taskId, now);
      // Visibly react to the hand-off: count it as fresh activity (wakes a
      // sleeping pet, calls a wanderer home, perks it to "watching") and play
      // an excited hop — the way a companion looks up when you give it a task.
      inputs.lastActivityAt = now;
      inputs.lastKeyAt = now;
      recompute();
      if (!prefersReducedMotion()) doFlourish(pickExcitedReaction());
      // Always acknowledge: a keyword-flavored line when the snippet matches,
      // otherwise a generic "on it". The rate limiter keeps rapid sends from
      // each popping a bubble even though the hop plays every time.
      say((snippet && classifyPromptSnippet(snippet)) || "prompt-sent");
      return;
    }
    case "memory:learned": {
      grantXp(XP_MEMORY_LEARNED);
      say("memory-learned");
      return;
    }
    case "graph:indexed": {
      say("graph-indexed");
      return;
    }
    case "worktree:created": {
      say("worktree-created");
      return;
    }
    case "project:created": {
      say("project-created");
      return;
    }
    case "diagram:show": {
      say("diagram-show");
      return;
    }
  }
}

/** Aggregate task counts across projects (from useProjects). */
export function petSetAggregates(counts: {
  running: number;
  needsInput: number;
  interrupted: number;
}): void {
  const crossedIntoFleet = counts.running >= 3 && inputs.runningCount < 3;
  const interruptedRose = counts.interrupted > aggregateInterrupted;
  inputs.runningCount = counts.running;
  aggregateNeedsInput = counts.needsInput;
  aggregateInterrupted = counts.interrupted;
  if (aggregateNeedsInput === 0 && questionTaskIds.size === 0) alert = null;
  if (interruptedRose) {
    petPulse("startle");
    say(noteFailure("interrupted"));
  }
  recompute();
  if (crossedIntoFleet) say("multi-agent");
  invalidate();
}

export function petSetShipping(active: boolean, phase: "committing" | "pushing" | null): void {
  const started = active && !inputs.shippingActive;
  const phaseChangedToPush = active && phase === "pushing";
  inputs.shippingActive = active;
  recompute();
  if (started && phase === "committing") sayWithCombo("ship-committing");
  else if (phaseChangedToPush) sayWithCombo("ship-pushing");
}

/** Outcome of a ship-family mutation (from the MutationCache). */
export function petShipResult(kind: "push-success" | "failure" | "pr-created"): void {
  if (!enabled) return;
  switch (kind) {
    case "push-success": {
      const comeback = noteSuccess();
      petPulse("celebrate");
      // Speak before granting XP so a level-up ding can't steal the story.
      say(comeback ?? "ship-success");
      grantXp(XP_SHIP_SUCCESS);
      return;
    }
    case "failure": {
      petPulse("startle");
      const trigger = noteFailure("ship-failure");
      // Streak escalations outrank the clock flavor; a plain failure may
      // still land as its late-night variant.
      if (trigger === "ship-failure") sayWithCombo(trigger);
      else say(trigger);
      return;
    }
    case "pr-created":
      noteSuccess();
      petPulse("celebrate");
      grantXp(XP_PR_CREATED);
      say("pr-created");
      return;
  }
}

export function petPulse(kind: "celebrate" | "startle"): void {
  if (!enabled) return;
  const now = Date.now();
  if (kind === "celebrate") inputs.celebrateUntil = now + CELEBRATE_MS;
  else inputs.startleUntil = now + STARTLE_MS;
  recompute();
}

export function petUserActivity(kind: "key" | "pointer", now: number = Date.now()): void {
  inputs.lastActivityAt = now;
  if (kind === "key") inputs.lastKeyAt = now;
  if (!enabled) return;
  recompute();
}

export function petSetWindowHidden(hidden: boolean): void {
  inputs.hiddenSince = hidden ? Date.now() : null;
  if (!hidden) inputs.lastActivityAt = Date.now();
  if (!enabled) return;
  recompute();
}

/**
 * Ambient one-liners the controller triggers on its slow clock — greetings,
 * idle/night flavor, calendar days, and uptime milestones. A brand-new pet's
 * first greeting becomes a hatch.
 */
export function petAmbientSay(trigger: PetTrigger): void {
  if (trigger === "greeting" && freshlyHatched) {
    say("hatch");
    return;
  }
  say(trigger);
}

/**
 * Click on the pet. When a session is blocked the click is a shortcut to it;
 * otherwise it's petting (hearts, a line, a trickle of XP).
 */
export function petInteract(): { navigateTo: { taskId: string; projectId: string } | null } {
  if (!enabled) return { navigateTo: null };
  if (alert && mood === "alert") return { navigateTo: alert };
  const now = Date.now();
  // Spam-clicking overwhelms the pet: it spins out dizzy (startled) instead
  // of endlessly lapping up affection.
  recentPetClicks = recentPetClicks.filter((t) => now - t < DIZZY_WINDOW_MS);
  recentPetClicks.push(now);
  if (recentPetClicks.length >= DIZZY_CLICK_COUNT) {
    recentPetClicks = [];
    // The dizzy complaint preempts whatever petting line is still up.
    if (bubble) {
      bubble = null;
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    doFlourish("spin");
    petPulse("startle");
    chirp("dizzy");
    say("overpet");
    return { navigateTo: null };
  }
  heartsBurstId += 1;
  // Every petting gets a random one-shot reaction alongside the hearts.
  doFlourish(pickReaction());
  chirp();
  if (now - lastPettingXpAt > PETTING_XP_COOLDOWN_MS) {
    lastPettingXpAt = now;
    grantXp(XP_PETTING);
  }
  say("petting");
  invalidate();
  return { navigateTo: null };
}

/**
 * Press-and-hold petting. The widget calls this on a slow tick while the
 * pointer stays down: hearts keep bursting, while the "petting" line and XP
 * stay behind their usual limiter/cooldown so holding isn't an XP farm.
 */
export function petStroke(): void {
  if (!enabled) return;
  heartsBurstId += 1;
  const now = Date.now();
  if (now - lastStrokeChirpAt > STROKE_CHIRP_MS) {
    lastStrokeChirpAt = now;
    chirp();
  }
  if (now - lastPettingXpAt > PETTING_XP_COOLDOWN_MS) {
    lastPettingXpAt = now;
    grantXp(XP_PETTING);
  }
  say("petting");
  invalidate();
}

// Dev harness: poke the pet from the console without faking real sessions.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).mcPet = {
    say: (trigger: PetTrigger) => say(trigger),
    pulse: petPulse,
    setAggregates: petSetAggregates,
    setShipping: petSetShipping,
    shipResult: petShipResult,
    ingest: petIngestServerEvent,
    stroke: petStroke,
    grantXp,
    walkTo: (x: number) => walkTo(x, WALK_SPEED_PX_PER_S),
    flourish: doFlourish,
    setMove: (m: number) => {
      move = ((m % PET_MOVES_PER_MOOD) + PET_MOVES_PER_MOOD) % PET_MOVES_PER_MOOD;
      invalidate();
    },
    state: () => snapshot,
  };
}
