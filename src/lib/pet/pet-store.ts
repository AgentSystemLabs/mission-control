import { useSyncExternalStore } from "react";
import type { ServerEvent } from "~/lib/use-events";
import {
  createDefaultPetState,
  levelForXp,
  type PetPersistentState,
} from "~/shared/pet";
import { createListenerSet } from "../listener-set";
import {
  bubbleDurationMs,
  classifyPromptSnippet,
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

export type PetSnapshot = {
  enabled: boolean;
  mood: PetMood;
  /** True between 22:00 and 06:00 — a visual modifier, not a mood. */
  night: boolean;
  /** Working animation speed, scaled by how many agents run in parallel. */
  intensity: 1 | 2 | 3;
  bubble: PetBubble | null;
  /** Most recent session waiting on the user; click-through target. */
  alert: { taskId: string; projectId: string } | null;
  name: string;
  xp: number;
  level: number;
  /** Increments on each petting; keys the hearts burst animation. */
  heartsBurstId: number;
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
let intensity: 1 | 2 | 3 = 1;
let pendingMood: PetMood | null = null;
let pendingSince = 0;
let bubble: PetBubble | null = null;
let bubbleId = 0;
let alert: { taskId: string; projectId: string } | null = null;
let heartsBurstId = 0;
let lastPettingXpAt = 0;

// Aggregate counts from useProjects can lag the SSE stream by a refetch, so
// question events maintain their own live set; needs-input uses whichever is
// larger.
const questionTaskIds = new Set<string>();
let aggregateNeedsInput = 0;
let aggregateInterrupted = 0;
// prompt:submitted timestamps, so session:finished can tell a long run.
const promptStartedAt = new Map<string, number>();

const limiter = createRateLimiter();
let levelUpCallback: ((level: number) => void) | null = null;

let snapshot: PetSnapshot = buildSnapshot();

function buildSnapshot(): PetSnapshot {
  return {
    enabled,
    mood,
    night: isNightHour(Date.now()),
    intensity,
    bubble,
    alert,
    name: persistent?.name ?? "",
    xp: persistent?.xp ?? 0,
    level: persistent?.level ?? 1,
    heartsBurstId,
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

function say(trigger: PetTrigger, opts?: { key?: string }): void {
  if (!enabled || !messagesEnabled || !persistent) return;
  const priority = TRIGGER_PRIORITY[trigger];
  // A visible bubble blocks new lines; only critical preempts it.
  if (bubble && priority !== "critical") return;
  if (!limiter.allow(trigger, opts?.key)) return;
  const text = pickLine(trigger, persistent.personality, {
    name: persistent.name,
    level: persistent.level,
    runningCount: inputs.runningCount,
  });
  if (!text) return;
  bubble = { id: ++bubbleId, text, priority };
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null;
    bubble = null;
    invalidate();
  }, bubbleDurationMs(text));
  invalidate();
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
    recompute();
  } else if (bubble) {
    bubble = null;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = null;
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
      petPulse("celebrate");
      grantXp(longRun ? XP_SESSION_FINISHED_LONG : XP_SESSION_FINISHED);
      say(longRun ? "session-finished-long" : "session-finished");
      return;
    }
    case "prompt:submitted": {
      const taskId = typeof event.taskId === "string" ? event.taskId : "";
      const snippet = typeof event.snippet === "string" ? event.snippet : "";
      if (taskId) promptStartedAt.set(taskId, Date.now());
      const trigger = snippet ? classifyPromptSnippet(snippet) : null;
      if (trigger) say(trigger);
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
    say("interrupted");
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
  if (started && phase === "committing") say("ship-committing");
  else if (phaseChangedToPush) say("ship-pushing");
}

/** Outcome of a ship-family mutation (from the MutationCache). */
export function petShipResult(kind: "push-success" | "failure" | "pr-created"): void {
  if (!enabled) return;
  switch (kind) {
    case "push-success":
      petPulse("celebrate");
      grantXp(XP_SHIP_SUCCESS);
      say("ship-success");
      return;
    case "failure":
      petPulse("startle");
      say("ship-failure");
      return;
    case "pr-created":
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
  heartsBurstId += 1;
  const now = Date.now();
  if (now - lastPettingXpAt > PETTING_XP_COOLDOWN_MS) {
    lastPettingXpAt = now;
    grantXp(XP_PETTING);
  }
  say("petting");
  invalidate();
  return { navigateTo: null };
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
    grantXp,
    state: () => snapshot,
  };
}
