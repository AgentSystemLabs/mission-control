import { useSyncExternalStore } from "react";
import type { ServerEvent } from "~/lib/use-events";
import {
  applyPersonalityDrift,
  bumpProjectXp,
  createDefaultPetState,
  createEmptyWeeklyStats,
  DEFAULT_PET_HOME_SIDE,
  DEFAULT_PET_SIZE,
  DEFAULT_PET_SPECIES,
  effectivePersonality,
  favoriteProjectOf,
  isPetSpeciesUnlocked,
  levelForXp,
  moltPetState,
  PET_EVOLUTION_LEVELS,
  PET_MAX_LEVEL,
  startOfWeek,
  type PetHomeSide,
  type PetLifetimeStats,
  type PetPersistentState,
  type PetPersonality,
  type PetSizeId,
  type PetSpeciesId,
  type PetWeeklyStats,
} from "~/shared/pet";
import { createListenerSet } from "../listener-set";
import { playPetChirp } from "./pet-sounds";
import {
  bubbleDurationMs,
  classifyPromptSnippet,
  mentionsPetName,
  comboTrigger,
  createRateLimiter,
  parsePetCommand,
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
  | "startled"
  | "singing";

export type PetBubble = { id: number; text: string; priority: PetMessagePriority };

/** Idle wandering along the bottom strip; x is px away from the home corner. */
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

/**
 * The fancier antics unlock as the pet levels, so a level-up visibly changes
 * behavior. Only the random pools are gated — direct commands ("Pixel,
 * dance") and scripted reactions (the toss spin) always play.
 */
const REACTION_MIN_LEVEL: Record<PetFlourish["kind"], number> = {
  hop: 1,
  stretch: 1,
  spin: 1,
  bound: 1,
  jump: 1,
  dance: 2,
  shimmy: 3,
  flip: 4,
  pounce: 5,
  tada: 6,
};

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
  /** Molt count — drives the permanent star badge and species unlocks. */
  prestige: number;
  /** Increments on each petting; keys the hearts burst animation. */
  heartsBurstId: number;
  wander: PetWander;
  flourish: PetFlourish | null;
  /** The stats card (right-click or "stats" command) is showing. */
  statsOpen: boolean;
  /** Bottom corner the pet homes in. */
  homeSide: PetHomeSide;
};

export type PetInputs = {
  runningCount: number;
  needsInputCount: number;
  shippingActive: boolean;
  startleUntil: number;
  celebrateUntil: number;
  /** A serenade — commanded ("Pixel, sing") or struck up as an idle antic —
   *  holds the singing mood until this passes. */
  singUntil: number;
  lastKeyAt: number;
  lastActivityAt: number;
  hiddenSince: number | null;
  /** A commanded nap ("Pixel, sleep") holds until this passes — see PET_NAP_MS. */
  napUntil: number;
};

export const MOOD_DEBOUNCE_MS = 1_200;
const WATCHING_WINDOW_MS = 8_000;
const IDLE_AFTER_MS = 5 * 60_000;
const HIDDEN_SLEEP_AFTER_MS = 60_000;
const CELEBRATE_MS = 5_000;
const STARTLE_MS = 3_000;
/** How long a serenade (commanded or idle-antic) holds the guitar out. */
const SING_MS = 6_000;
/**
 * How long a commanded nap ("Pixel, sleep") lasts. Long enough to be a real
 * state — the agent answering and the session finishing must not wake it
 * (that churn is exactly what the command escapes) — short enough that the
 * pet is back on duty without being poked.
 */
export const PET_NAP_MS = 90_000;
const LONG_RUN_MS = 20 * 60_000;
const PETTING_XP_COOLDOWN_MS = 60_000;
const CLOCK_TICK_MS = 30_000;
/** This many clicks inside the window makes the pet dizzy instead of happy. */
const DIZZY_CLICK_COUNT = 5;
const DIZZY_WINDOW_MS = 2_500;
/** Hold-to-pet murmurs on this throttle, not on every 600ms stroke tick. */
const STROKE_CHIRP_MS = 1_500;

/** How far from its home corner the pet may wander, in px. */
export const PET_WANDER_RANGE_PX = 300;
const WALK_SPEED_PX_PER_S = 45;
const HOME_SPEED_PX_PER_S = 120;
const BEHAVIOR_TICK_MS = 6_500;
const FLOURISH_MS = 1_400;
/**
 * Client-side floor between mid-run tool reactions (a "still working" antic).
 * The hook already throttles the POST, but several sessions can each fire, so
 * this keeps a busy grid from chaining antics. Errors bypass it — they lean on
 * the say() cooldown instead, so a genuine failure is never silently dropped.
 */
const TOOL_REACT_THROTTLE_MS = 8_000;

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
 * XP awards per event, grouped for the settings guide so its numbers can
 * never drift from what the store actually grants.
 */
export const PET_XP_AWARDS = {
  sessionFinished: XP_SESSION_FINISHED,
  sessionFinishedLong: XP_SESSION_FINISHED_LONG,
  shipSuccess: XP_SHIP_SUCCESS,
  prCreated: XP_PR_CREATED,
  memoryLearned: XP_MEMORY_LEARNED,
  petting: XP_PETTING,
} as const;

/** Cached uncommitted-file count that earns the evening nudge. */
const UNCOMMITTED_NUDGE_THRESHOLD = 10;
/** How long a tossed pet sits dazed where it landed before trotting home. */
const TOSS_REST_MS = 2_500;
/**
 * Personality drift per formative event — small enough that character changes
 * over weeks of real work, not an afternoon (the cap is ±2 stat points).
 */
const DRIFT_NUDGE = 0.15;
const DRIFT_NUDGE_SMALL = 0.1;

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
  // A commanded nap outranks the work chatter below it: without this the
  // response to the very prompt that ordered the nap (running → finished →
  // celebrating) would wake the pet within a second. Only a blocked session
  // or a startle interrupts.
  if (now < inputs.napUntil) return { mood: "sleeping", intensity };
  // A serenade — commanded or struck up on an idle whim — outranks ambient
  // work chatter so it reliably plays out, but still yields to a genuine
  // alert, startle, or nap above.
  if (now < inputs.singUntil) return { mood: "singing", intensity };
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
  "singing",
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
let homeSide: PetHomeSide = DEFAULT_PET_HOME_SIDE;
let hydrated = false;
// True when this boot rolled a brand-new pet — the greeting becomes a hatch.
let freshlyHatched = false;
let persistent: PetPersistentState | null = null;

/** Idle facing at rest for the current home corner. */
function homeRestFacing(): 1 | -1 {
  return homeSide === "right" ? 1 : -1;
}

const inputs: PetInputs = {
  runningCount: 0,
  needsInputCount: 0,
  shippingActive: false,
  startleUntil: 0,
  celebrateUntil: 0,
  singUntil: 0,
  lastKeyAt: 0,
  lastActivityAt: Date.now(),
  hiddenSince: null,
  napUntil: 0,
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
let statsOpen = false;
// Largest cached uncommitted-file count the controller last reported.
let uncommittedCount = 0;
// When a blocked session's grid cell is on screen, the pet walks under it and
// stays there (instead of walking home) until the question clears.
let alertWalkX: number | null = null;
// Freshly tossed: the pet sits where it landed until this passes — the
// startle's own walkHome (via commitMood) must not teleport it home mid-daze.
let tossedRestUntil = 0;
// Picked up by the user: every walk is frozen until the toss lands, so the
// walker can't keep sliding underneath the drag.
let heldByUser = false;

// Aggregate counts from useProjects can lag the SSE stream by a refetch, so
// question events maintain their own live set; needs-input uses whichever is
// larger.
const questionTaskIds = new Set<string>();
// The set is pruned by task:question-cleared / task:deleted / a tool run — but
// those all arrive over SSE, so a dropped event (reconnect gap) would leave the
// pet alert forever. The aggregates are authoritative once refetched: after
// this many consecutive zero needs-input reports with the set still non-empty,
// the entries are stale — clear them. (>1 so a fresh question isn't culled by
// a refetch that raced in before its status landed.)
const STALE_QUESTION_ZERO_REPORTS = 3;
let staleQuestionZeroReports = 0;
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
  bumpStats(
    persistent && failureStreak > persistent.stats.worstStreak
      ? { failures: 1, worstStreak: failureStreak - persistent.stats.worstStreak }
      : { failures: 1 },
    { failures: 1 },
  );
  // Surviving a streak tier leaves a mark: the pet gets a little snarkier.
  if (failureStreak === 3 || failureStreak === 5 || failureStreak === 10 || failureStreak === 20) {
    driftPersonality({ snark: DRIFT_NUDGE });
  }
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
    prestige: persistent?.prestige ?? 0,
    heartsBurstId,
    wander,
    flourish,
    statsOpen,
    homeSide,
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
    // Hidden tab: nothing renders, so skip the recompute/invalidate churn. The
    // controller re-syncs the mood via petSetWindowHidden(false) on the next
    // visibilitychange, so no transition is lost.
    if (typeof document !== "undefined" && document.hidden) return;
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

/** Walk to `target` px away from home. The widget renders it as a CSS transition.
 * `maxX` defaults to the idle wander strip; the alert walk passes the viewport. */
function walkTo(target: number, speedPxPerS: number, maxX: number = PET_WANDER_RANGE_PX): void {
  // In the user's hand: nothing walks the pet anywhere until it's put down.
  if (heldByUser) return;
  const clamped = Math.min(maxX, Math.max(0, Math.round(target)));
  const dist = Math.abs(clamped - wander.x);
  if (dist < 12) return;
  const durationMs = (dist / speedPxPerS) * 1000;
  // Increasing x = heading away from home (leftward on the right corner,
  // rightward on the left corner). Facing follows that direction.
  const awayFacing: 1 | -1 = homeSide === "right" ? -1 : 1;
  wander = {
    x: clamped,
    walking: true,
    durationMs,
    facing: clamped > wander.x ? awayFacing : ((-awayFacing) as 1 | -1),
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
  if (Date.now() < tossedRestUntil) return;
  if (wander.x === 0 && !wander.walking) return;
  walkTo(0, HOME_SPEED_PX_PER_S);
}

/**
 * Walk under the blocked session's grid cell and stay there — the alert made
 * spatial. No-ops when the cell isn't on screen or motion is reduced; the
 * bubble and mood carry the message on their own.
 */
function walkToAlertCell(taskId: string): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  const cell = document.querySelector(
    `[data-grid-cell][data-task-id="${CSS.escape(taskId)}"]`,
  );
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  if (rect.width === 0) return;
  // wander.x counts px away from the home corner; aim the pet's center
  // (~42px half-sprite) at the cell's center, staying on screen.
  const homeInset = 18;
  const halfSprite = 42;
  const cellCenter = rect.left + rect.width / 2;
  const homeCenterX =
    homeSide === "right"
      ? window.innerWidth - homeInset - halfSprite
      : homeInset + halfSprite;
  const target =
    homeSide === "right" ? homeCenterX - cellCenter : cellCenter - homeCenterX;
  if (target <= 0) return;
  alertWalkX = Math.min(window.innerWidth - 140, target);
  walkTo(alertWalkX, HOME_SPEED_PX_PER_S, window.innerWidth);
}

function clearAlertWalk(): void {
  if (alertWalkX === null) return;
  alertWalkX = null;
  walkHome();
}

/** Pick a fresh animation variant for the current mood — never the same twice. */
function rollMove(): void {
  const next = Math.floor(Math.random() * (PET_MOVES_PER_MOOD - 1));
  move = next >= move ? next + 1 : next;
}

/** The subset of `pool` this pet has unlocked (never empty — hop is level 1). */
function unlockedReactions(pool: readonly PetFlourish["kind"][]): PetFlourish["kind"][] {
  const level = persistent?.level ?? 1;
  return pool.filter((kind) => REACTION_MIN_LEVEL[kind] <= level);
}

let lastReactionKind: PetFlourish["kind"] | null = null;

/** Random petting reaction from the unlocked pool, never twice in a row. */
function pickReaction(): PetFlourish["kind"] {
  const pool = unlockedReactions(PET_REACTIONS);
  const options = pool.length > 1 ? pool.filter((kind) => kind !== lastReactionKind) : pool;
  lastReactionKind = options[Math.floor(Math.random() * options.length)];
  return lastReactionKind;
}

let lastExcitedKind: PetFlourish["kind"] | null = null;
let lastToolReactAt = 0;

/** Random upbeat reaction for a prompt send, never repeating the previous one. */
function pickExcitedReaction(): PetFlourish["kind"] {
  const pool = unlockedReactions(PET_EXCITED_REACTIONS);
  const options = pool.length > 1 ? pool.filter((kind) => kind !== lastExcitedKind) : pool;
  lastExcitedKind = options[Math.floor(Math.random() * options.length)];
  return lastExcitedKind;
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
    // Hidden tab: the widget is off-screen and its ambient animations are frozen
    // (see styles.css power-save / reduced-motion blocks), so idle antics and
    // wandering would just burn CPU updating nothing. Resume when visible again.
    if (typeof document !== "undefined" && document.hidden) return;
    // Whatever the mood, occasionally switch to another of its move variants
    // so the pet doesn't loop one animation forever.
    if (Math.random() < 0.45) {
      rollMove();
      invalidate();
    }
    if (mood !== "idle") {
      // Posted under a blocked cell, the pet holds position instead of
      // drifting home — that's the whole point of walking there.
      if (!(mood === "alert" && alertWalkX !== null)) walkHome();
      return;
    }
    const roll = Math.random();
    if (roll < 0.45) walkTo(Math.random() * PET_WANDER_RANGE_PX, WALK_SPEED_PX_PER_S);
    else if (roll < 0.6) doFlourish("hop");
    else if (roll < 0.72) doFlourish("stretch");
    // Veterans show off: the occasional unprompted backflip from level 7.
    else if (roll < 0.78 && (persistent?.level ?? 1) >= 7) doFlourish("flip");
    // Or strike up a little unprompted serenade, right where it stands —
    // same timed mood as "Pixel, sing", just self-initiated.
    else if (roll >= 0.78 && roll < 0.86) {
      inputs.singUntil = Date.now() + SING_MS;
      recompute();
    }
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
    // Timed moods that landed through the debounce path (a commanded nap)
    // still need their expiry re-check scheduled.
    schedulePulseExpiry(now);
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
  // Real activity (or bedtime) interrupts the stroll — hurry back to the
  // corner, unless the pet is posted under a blocked cell. A serenade is the
  // exception: the pet sings right where it stands, mid-stroll or not.
  if (mood !== "idle" && mood !== "singing" && !(mood === "alert" && alertWalkX !== null))
    walkHome();
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
  const until = Math.max(inputs.startleUntil, inputs.celebrateUntil, inputs.napUntil);
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
  // A visible bubble blocks new lines; only critical preempts it — plus the
  // molt announcement: it answers an explicit user action and is rare enough
  // that dropping it behind whatever line is still up (typically the level-10
  // one) would read as a silent no-op. Plain level-up/evolve stay blocked on
  // purpose: the finish's story (comeback, milestone) outranks them.
  if (bubble && priority !== "critical" && trigger !== "molt") return false;
  if (!limiter.allow(trigger, opts?.key)) return false;
  const favorite = favoriteProjectOf(persistent.projectXp);
  const text = pickLine(trigger, persistent.personality, {
    name: persistent.name,
    level: persistent.level,
    prestige: persistent.prestige,
    runningCount: inputs.runningCount,
    sessionsFinished: sessionsFinishedCount,
    species: persistent.species,
    uncommittedCount,
    favoriteProject: favorite?.name ?? null,
    ageDays: Math.max(0, Math.floor((Date.now() - persistent.createdAt) / 86_400_000)),
    weekly: {
      sessions: persistent.weekly.sessions,
      ships: persistent.weekly.ships,
      prs: persistent.weekly.prs,
      failures: persistent.weekly.failures,
    },
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

// Which line pack answers each classified tool result. "neutral" and the
// generic "error" kind stay unmapped on purpose — they fall through to the
// existing agent-working / agent-error packs.
const TOOL_KIND_TRIGGERS: Partial<Record<string, PetTrigger>> = {
  "merge-conflict": "tool-merge-conflict",
  "test-fail": "tool-test-fail",
  "type-error": "tool-type-error",
  "build-fail": "tool-build-fail",
  "lint-fail": "tool-lint-fail",
  commit: "tool-commit",
  push: "tool-push",
  "tests-pass": "tool-tests-pass",
  deploy: "tool-deploy",
  "edit-test": "edit-test",
  "edit-styles": "edit-styles",
  "edit-docs": "edit-docs",
  "edit-config": "edit-config",
  "edit-lockfile": "edit-lockfile",
  "edit-migration": "edit-migration",
};

// Claude's `<!-- pet: … -->` cues arrive at most once per turn; this local
// floor only matters when several sessions finish together — one voice at a
// time, the rest of the chorus waits for the next turn.
const REMARK_COOLDOWN_MS = 30_000;
let lastRemarkAt = 0;

/** Speak a line Claude wrote for the pet, verbatim. Rarer than any stock
 * pack, so it preempts an open bubble the way critical lines do. */
function sayRemark(text: string): void {
  if (!enabled || !messagesEnabled || !persistent) return;
  // A remark preempts an open bubble like a rare line does — but never a
  // critical one: another session's "needs input" alert must outlast a
  // finishing session's chatter (mirrors say()'s critical-only preemption).
  if (bubble && bubble.priority === "critical") return;
  const now = Date.now();
  if (now - lastRemarkAt < REMARK_COOLDOWN_MS) return;
  lastRemarkAt = now;
  bubble = { id: ++bubbleId, text, priority: "info" };
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null;
    bubble = null;
    invalidate();
  }, bubbleDurationMs(text));
  chirp();
  invalidate();
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
    // Landing on an evolution threshold announces the new permanent detail
    // instead of the plain level-up line.
    say(PET_EVOLUTION_LEVELS.has(level) ? "evolve" : "level-up");
    levelUpCallback?.(level);
  }
  notifyPersistence();
  invalidate();
}

/** Increment lifetime (and optionally this week's) counters, rolling the
 * weekly window over when a new week has started. */
function bumpStats(
  lifetime: Partial<PetLifetimeStats>,
  weekly?: Partial<Pick<PetWeeklyStats, "sessions" | "ships" | "prs" | "failures">>,
): void {
  if (!persistent) return;
  const now = Date.now();
  const stats = { ...persistent.stats };
  for (const [key, amount] of Object.entries(lifetime) as [keyof PetLifetimeStats, number][]) {
    stats[key] += amount;
  }
  let week = persistent.weekly;
  if (startOfWeek(now) !== week.weekStart) week = createEmptyWeeklyStats(now);
  if (weekly) {
    week = { ...week };
    for (const [key, amount] of Object.entries(weekly) as [
      "sessions" | "ships" | "prs" | "failures",
      number,
    ][]) {
      week[key] += amount;
    }
  }
  persistent = { ...persistent, stats, weekly: week };
  notifyPersistence();
}

/** Formative events slowly reshape the personality around its rolled base. */
function driftPersonality(nudge: Partial<PetPersonality>): void {
  if (!persistent) return;
  const personalityDrift = applyPersonalityDrift(persistent.personalityDrift, nudge);
  persistent = {
    ...persistent,
    personalityDrift,
    personality: effectivePersonality(persistent.personalityBase, personalityDrift),
  };
  notifyPersistence();
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
    wander = { x: 0, walking: false, durationMs: 0, facing: homeRestFacing() };
    flourish = null;
    statsOpen = false;
    alertWalkX = null;
    heldByUser = false;
    inputs.napUntil = 0;
    // A disabled pet should cost nothing: stop the ambient loops and any
    // in-flight one-shot timers. ensureClock/ensureBehaviorLoop re-arm on
    // the next enable.
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (behaviorTimer !== null) {
      clearInterval(behaviorTimer);
      behaviorTimer = null;
    }
    for (const timer of [pendingTimer, pulseTimer, watchTimer, arriveTimer, flourishTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    pendingTimer = pulseTimer = watchTimer = arriveTimer = flourishTimer = null;
    pendingMood = null;
  }
  invalidate();
}

/**
 * Which bottom corner the pet homes in. Flipping sides snaps it home so a
 * mid-wander teleport doesn't leave it stranded on the wrong half of the strip.
 */
export function petSetHomeSide(side: PetHomeSide): void {
  if (homeSide === side) return;
  homeSide = side;
  if (arriveTimer) {
    clearTimeout(arriveTimer);
    arriveTimer = null;
  }
  wander = {
    x: 0,
    walking: false,
    durationMs: 0,
    facing: homeRestFacing(),
  };
  alertWalkX = null;
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
  // The prestige species is earned by molting, not picked early.
  if (!isPetSpeciesUnlocked(species, persistent.prestige)) return;
  persistent = { ...persistent, species };
  notifyPersistence();
  invalidate();
}

/**
 * Molt: the prestige reset, offered on the stats card at the level cap. XP
 * and level return to the start, the molt count (and its permanent star)
 * increments, and everything lived-in — stats, drift, favorite project,
 * hatch date — survives. Returns false when not at the cap.
 */
export function petMolt(): boolean {
  if (!enabled || !persistent || persistent.level < PET_MAX_LEVEL) return false;
  persistent = moltPetState(persistent);
  petPulse("celebrate");
  if (!prefersReducedMotion()) doFlourish("tada");
  say("molt");
  notifyPersistence();
  invalidate();
  return true;
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
      staleQuestionZeroReports = 0;
      alert = { taskId, projectId };
      recompute();
      say("needs-input", { key: taskId });
      // Make the alert spatial: trot over and stand under the blocked cell.
      walkToAlertCell(taskId);
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
      if (alert?.taskId === taskId) {
        alert = null;
        clearAlertWalk();
      }
      promptStartedAt.delete(taskId);
      recompute();
      invalidate();
      return;
    }
    case "session:finished": {
      const taskId = typeof event.id === "string" ? event.id : "";
      const projectId = typeof event.projectId === "string" ? event.projectId : "";
      const projectName = typeof event.projectName === "string" ? event.projectName : "";
      const startedAt = taskId ? promptStartedAt.get(taskId) : undefined;
      if (taskId) promptStartedAt.delete(taskId);
      const longRun = startedAt !== undefined && Date.now() - startedAt > LONG_RUN_MS;
      sessionsFinishedCount += 1;
      const comeback = noteSuccess();
      petPulse("celebrate");
      const xpAmount = longRun ? XP_SESSION_FINISHED_LONG : XP_SESSION_FINISHED;
      bumpStats({ sessions: 1, ...(longRun ? { longSessions: 1 } : {}) }, { sessions: 1 });
      // Sitting through a long run teaches patience.
      if (longRun) driftPersonality({ zen: DRIFT_NUDGE_SMALL });
      // Real work in a real project earns that project a spot in the pet's
      // heart; the top earner (with a clear lead) becomes its favorite.
      if (persistent && projectId && projectName) {
        persistent = {
          ...persistent,
          projectXp: bumpProjectXp(persistent.projectXp, projectId, projectName, xpAmount),
        };
        notifyPersistence();
      }
      const favorite = persistent ? favoriteProjectOf(persistent.projectXp) : null;
      const inFavorite = favorite !== null && favorite.projectId === projectId;
      // One bubble per finish — the rarest story wins: ending a losing streak
      // beats a count milestone beats favorite-project affection (whose long
      // cooldown makes it rare) beats the routine line. Speak before granting
      // XP so a level-up ding can't steal the finish's story.
      if (comeback) say(comeback);
      else if (isSessionMilestone(sessionsFinishedCount)) say("session-milestone");
      else if (!(inFavorite && say("favorite-project"))) {
        say(longRun ? "session-finished-long" : "session-finished");
      }
      grantXp(xpAmount);
      return;
    }
    case "prompt:submitted": {
      const taskId = typeof event.taskId === "string" ? event.taskId : "";
      const snippet = typeof event.snippet === "string" ? event.snippet : "";
      const now = Date.now();
      if (taskId) promptStartedAt.set(taskId, now);
      // Its own name in the prompt is addressed to the pet, not the agents —
      // parse it up front so a "sleep" order starts the nap BEFORE the
      // excited hop below (which it suppresses), not after.
      const addressed = Boolean(
        snippet && persistent && mentionsPetName(snippet, persistent.name),
      );
      const command = addressed ? parsePetCommand(snippet) : null;
      // Being addressed by name wakes a napping pet — unless the order IS
      // the nap. Un-addressed prompts leave the nap alone: it was an
      // explicit command, and ambient work shouldn't undo it.
      if (command === "sleep") inputs.napUntil = now + PET_NAP_MS;
      else if (addressed) inputs.napUntil = 0;
      // Strike up the serenade before the recompute below so the singing mood
      // (guitar + notes) commits on this same signal, the way a nap does.
      if (command === "sing") inputs.singUntil = now + SING_MS;
      const napping = now < inputs.napUntil;
      // Visibly react to the hand-off: count it as fresh activity (wakes a
      // sleeping pet, calls a wanderer home, perks it to "watching") and play
      // an excited hop — the way a companion looks up when you give it a task.
      inputs.lastActivityAt = now;
      inputs.lastKeyAt = now;
      recompute();
      if (!prefersReducedMotion() && !napping) doFlourish(pickExcitedReaction());
      // Commands beat the plain name-answer: "Pixel, dance" gets a dance,
      // not a "you rang?". Otherwise acknowledge: a keyword-flavored line
      // when the snippet matches, or a generic "on it". The rate limiter
      // keeps rapid sends from each popping a bubble even though the hop
      // plays every time.
      if (addressed) {
        if (command === "dance") {
          if (!prefersReducedMotion()) doFlourish("dance");
          say("command-dance");
        } else if (command === "sleep") {
          say("command-sleep");
        } else if (command === "sing") {
          chirp();
          say("command-sing");
        } else if (command === "stats") {
          statsOpen = true;
          say("command-stats");
          invalidate();
        } else {
          say("name-mentioned");
        }
      } else if (!napping) {
        say((snippet && classifyPromptSnippet(snippet)) || "prompt-sent");
      }
      return;
    }
    case "memory:learned": {
      bumpStats({ memories: 1 });
      // Watching knowledge accumulate makes the pet a little wiser.
      driftPersonality({ wisdom: DRIFT_NUDGE_SMALL });
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
    case "agent:tool-used": {
      // The agent ran a Bash/Write/Edit tool mid-turn. Keep the pet awake and
      // let it react to what the tool did. The server only emits this while the
      // pet is enabled, and the hook that produces it is only installed then —
      // this case is the third, renderer-side gate (petIngestServerEvent already
      // bailed above if the pet is off).
      const now = Date.now();
      inputs.lastActivityAt = now;
      // A tool running in this task proves the agent resumed after any question,
      // so a needs-input alert left over from an AskUserQuestion is stale —
      // stand it down locally even if the server's task:question-cleared was
      // missed. (The server also heals the task status; this is defense in depth.)
      const toolTaskId = typeof event.taskId === "string" ? event.taskId : "";
      if (toolTaskId && questionTaskIds.delete(toolTaskId) && alert?.taskId === toolTaskId) {
        alert = null;
        clearAlertWalk();
      }
      // The server classifies what the tool actually did (commit, test-fail,
      // edit-styles…, see ~/shared/pet-tool-classify); sentiment is the coarse
      // rollup and the fallback for payloads that predate `kind`.
      const kind = typeof event.kind === "string" ? event.kind : "neutral";
      const sentiment =
        event.sentiment === "error" || event.sentiment === "success"
          ? event.sentiment
          : "neutral";
      // Visual reaction (skipped under reduced-motion, independent of the
      // messages toggle — like prompt:submitted always hops). An error always
      // startles and a win always celebrates: both are worth registering, and
      // the hook's own cooldown already bounds them to ~once/20s per session.
      // A routine tool only gets an occasional low-key antic, floored so a
      // busy grid can't chain motion.
      if (!prefersReducedMotion()) {
        if (sentiment === "error") {
          petPulse("startle");
        } else if (sentiment === "success") {
          petPulse("celebrate");
        } else if (now - lastToolReactAt >= TOOL_REACT_THROTTLE_MS) {
          lastToolReactAt = now;
          doFlourish("stretch");
        }
      }
      // A line, on its own per-trigger cooldown — gated by the messages toggle
      // inside say(). The specific classified line first; when its pack has no
      // trigger (kind is neutral/error) or it's rate-limited into silence,
      // errors still fall back to the generic concerned line.
      const trigger = TOOL_KIND_TRIGGERS[kind];
      if (trigger) {
        if (!say(trigger) && sentiment === "error") say("agent-error");
      } else {
        say(sentiment === "error" ? "agent-error" : "agent-working");
      }
      recompute();
      return;
    }
    case "agent:remark": {
      // Claude ended its turn with an invisible `<!-- pet: … -->` cue — the
      // agent talking to the pet directly. Speak it verbatim: it outranks the
      // stock finish line (this event lands just before session:finished, so
      // the bubble it opens blocks that one).
      const text = typeof event.text === "string" ? event.text : "";
      if (text) sayRemark(text);
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
  // Reconcile against dropped SSE events: enough consecutive authoritative
  // "nothing needs input" reports mean the tracked question ids are stale
  // (their cleared/deleted events never arrived) — without this the pet stays
  // alert forever on a task that already resumed or vanished.
  if (counts.needsInput === 0 && questionTaskIds.size > 0) {
    staleQuestionZeroReports += 1;
    if (staleQuestionZeroReports >= STALE_QUESTION_ZERO_REPORTS) {
      staleQuestionZeroReports = 0;
      questionTaskIds.clear();
    }
  } else {
    staleQuestionZeroReports = 0;
  }
  if (aggregateNeedsInput === 0 && questionTaskIds.size === 0) {
    alert = null;
    clearAlertWalk();
  }
  if (interruptedRose) {
    petPulse("startle");
    say(noteFailure("interrupted"));
  }
  recompute();
  if (crossedIntoFleet) {
    // Running a fleet rubs off — a little more chaos each time.
    driftPersonality({ chaos: DRIFT_NUDGE });
    say("multi-agent");
  }
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
      bumpStats({ ships: 1 }, { ships: 1 });
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
      bumpStats({ prs: 1 }, { prs: 1 });
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
  // The recap only speaks when this week actually has history — a quiet week
  // (or counters carried over from a stale week) falls back to plain friday.
  if (trigger === "friday-recap") {
    const week = persistent?.weekly;
    if (!week || week.sessions === 0 || week.weekStart !== startOfWeek(Date.now())) return;
  }
  // Enduring a marathon uptime teaches a certain calm. The ambient tick
  // repeats this trigger every minute past the threshold, so the drift keys
  // off the once-per-boot line actually landing.
  if (trigger === "marathon") {
    if (say("marathon")) driftPersonality({ zen: DRIFT_NUDGE });
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
  // A click wakes a commanded nap — physical affection outranks the order.
  if (inputs.napUntil > now) {
    inputs.napUntil = 0;
    recompute();
  }
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
    // Getting spam-clicked dizzy leaves a snarky residue.
    driftPersonality({ snark: DRIFT_NUDGE_SMALL });
    say("overpet");
    return { navigateTo: null };
  }
  heartsBurstId += 1;
  // Every petting gets a random one-shot reaction alongside the hearts.
  doFlourish(pickReaction());
  chirp();
  if (now - lastPettingXpAt > PETTING_XP_COOLDOWN_MS) {
    lastPettingXpAt = now;
    bumpStats({ pets: 1 });
    grantXp(XP_PETTING);
  }
  say("petting");
  invalidate();
  return { navigateTo: null };
}

/** Open/close the stats card (right-click on the pet, or a "stats" command). */
export function petSetStatsOpen(open: boolean): void {
  if (statsOpen === open) return;
  statsOpen = open;
  invalidate();
}

/**
 * The controller reports the largest cached uncommitted-file count during
 * evening hours; a big enough pile earns a (heavily rate-limited) nudge.
 */
export function petNoteUncommitted(count: number): void {
  if (!enabled) return;
  uncommittedCount = count;
  if (count >= UNCOMMITTED_NUDGE_THRESHOLD) say("uncommitted-pile");
}

/**
 * Dragged and dropped by the user. The widget owns the drag + fall animation
 * and hands over the landing spot (px away from home); the pet lands there,
 * spins out dizzy, and — since the startle pulse routes through commitMood —
 * walks itself home once it gathers its wits.
 */
/**
 * The user picked the pet up (a drag activated). Pin it at its current
 * *visual* position — mid-walk the store already holds the walk's target, not
 * where the pet is — and freeze all walking until petTossed puts it down.
 * Without this, a walk-home keeps sliding the walker underneath the drag and
 * the combined offset carries the pet off screen.
 */
export function petGrabbed(visualX: number): void {
  if (!enabled) return;
  heldByUser = true;
  // Being picked up ends a commanded nap.
  inputs.napUntil = 0;
  if (arriveTimer) {
    clearTimeout(arriveTimer);
    arriveTimer = null;
  }
  wander = {
    x: Math.max(0, Math.round(visualX)),
    walking: false,
    durationMs: 0,
    facing: wander.facing,
  };
  invalidate();
}

export function petTossed(landingX: number, side?: PetHomeSide): void {
  if (!enabled) return;
  heldByUser = false;
  if (arriveTimer) {
    clearTimeout(arriveTimer);
    arriveTimer = null;
  }
  // Dropped across the screen's midpoint: re-home the pet to that side so it
  // settles where you left it and walks back to the near corner, instead of
  // trekking all the way to its old home. landingX is already the distance
  // from the (possibly new) home edge, measured by the caller.
  if (side && side !== homeSide) {
    homeSide = side;
    alertWalkX = null;
  }
  wander = {
    x: Math.max(0, Math.round(landingX)),
    walking: false,
    durationMs: 0,
    facing: homeRestFacing(),
  };
  // Sit dazed where it landed — walkHome() is a no-op until the rest passes
  // (the startle pulse below routes through commitMood, which walks home).
  tossedRestUntil = Date.now() + TOSS_REST_MS;
  doFlourish("spin");
  chirp("dizzy");
  say("tossed");
  petPulse("startle");
  invalidate();
  setTimeout(() => {
    tossedRestUntil = 0;
    if (enabled) walkHome();
  }, TOSS_REST_MS);
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
    bumpStats({ pets: 1 });
    grantXp(XP_PETTING);
  }
  say("petting");
  invalidate();
}

// Dev harness: poke the pet from the console without faking real sessions.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).mcPet = {
    // Force-enable outside Electron (plain-browser dev has no settings auth).
    enable: () => {
      petHydrate(null);
      petSetEnabled(true, true, false);
    },
    say: (trigger: PetTrigger) => say(trigger),
    pulse: petPulse,
    setAggregates: petSetAggregates,
    setShipping: petSetShipping,
    shipResult: petShipResult,
    ingest: petIngestServerEvent,
    stroke: petStroke,
    grantXp,
    molt: petMolt,
    setSpecies: petSetSpecies,
    // Roll a brand-new pet (fresh personality, level 1, prestige 0 — Ember
    // locks again) and persist it through the normal debounced save.
    reset: () => {
      persistent = createDefaultPetState();
      notifyPersistence();
      invalidate();
    },
    tossed: petTossed,
    statsOpen: petSetStatsOpen,
    noteUncommitted: petNoteUncommitted,
    walkTo: (x: number) => walkTo(x, WALK_SPEED_PX_PER_S),
    flourish: doFlourish,
    setMove: (m: number) => {
      move = ((m % PET_MOVES_PER_MOOD) + PET_MOVES_PER_MOOD) % PET_MOVES_PER_MOOD;
      invalidate();
    },
    state: () => snapshot,
  };
}
