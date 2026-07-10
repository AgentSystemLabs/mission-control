import type { PetPersonality } from "~/shared/pet";
import { PET_LINES } from "./pet-lines";

/**
 * Mission Pet message plumbing: which triggers exist, how loud each one is,
 * how often it may fire, and how a line is picked from the packs. Pure and
 * clock-injectable so the rate limiter and picker are unit-testable.
 */

export type PetMessagePriority = "critical" | "info" | "flavor";

export type PetTrigger =
  | "greeting"
  | "session-finished"
  | "session-finished-long"
  | "needs-input"
  | "ship-committing"
  | "ship-pushing"
  | "ship-success"
  | "ship-failure"
  | "pr-created"
  | "multi-agent"
  | "prompt-fix"
  | "prompt-test"
  | "prompt-refactor"
  | "prompt-deploy"
  | "memory-learned"
  | "graph-indexed"
  | "interrupted"
  | "idle"
  | "night"
  | "petting"
  | "level-up";

export type PetLineCtx = {
  name: string;
  level: number;
  runningCount: number;
};

export type PetLine = {
  text: string | ((ctx: PetLineCtx) => string);
  /** Personality stats that make this line more likely (see pickLine). */
  weights?: Partial<PetPersonality>;
};

/**
 * critical — the user should act (blocked agent, failed ship). Preempts a
 * visible bubble and bypasses the global bucket.
 * info — worth a glance; flavor — pure ambience, first to be dropped.
 */
export const TRIGGER_PRIORITY: Record<PetTrigger, PetMessagePriority> = {
  greeting: "info",
  "session-finished": "info",
  "session-finished-long": "info",
  "needs-input": "critical",
  "ship-committing": "info",
  "ship-pushing": "info",
  "ship-success": "info",
  "ship-failure": "critical",
  "pr-created": "info",
  "multi-agent": "flavor",
  "prompt-fix": "flavor",
  "prompt-test": "flavor",
  "prompt-refactor": "flavor",
  "prompt-deploy": "flavor",
  "memory-learned": "flavor",
  "graph-indexed": "flavor",
  interrupted: "info",
  idle: "flavor",
  night: "flavor",
  petting: "info",
  "level-up": "info",
};

/** Infinity = once per app boot (the limiter is module-lifetime). */
const TRIGGER_COOLDOWN_MS: Record<PetTrigger, number> = {
  greeting: Infinity,
  "session-finished": 45_000,
  "session-finished-long": 45_000,
  "needs-input": 60_000,
  "ship-committing": 30_000,
  "ship-pushing": 30_000,
  "ship-success": 30_000,
  "ship-failure": 30_000,
  "pr-created": 300_000,
  "multi-agent": 600_000,
  "prompt-fix": 90_000,
  "prompt-test": 90_000,
  "prompt-refactor": 90_000,
  "prompt-deploy": 90_000,
  "memory-learned": 300_000,
  "graph-indexed": 300_000,
  interrupted: 60_000,
  idle: 900_000,
  night: 1_800_000,
  petting: 20_000,
  "level-up": 0,
};

// The global bucket keeps the pet charming instead of noisy: at most this many
// non-exempt messages inside a sliding window. Critical triggers and direct
// responses to the user (petting, level-up) don't count against it.
const GLOBAL_WINDOW_MS = 600_000;
const GLOBAL_MAX = 6;
const BUCKET_EXEMPT: ReadonlySet<PetTrigger> = new Set(["petting", "level-up"]);

export function createRateLimiter(now: () => number = Date.now): {
  allow(trigger: PetTrigger, key?: string): boolean;
} {
  const lastFired = new Map<string, number>();
  const bucket: number[] = [];
  return {
    /** `key` scopes the cooldown (e.g. needs-input per taskId). */
    allow(trigger, key) {
      const t = now();
      const cooldown = TRIGGER_COOLDOWN_MS[trigger];
      const cooldownKey = key ? `${trigger}:${key}` : trigger;
      const last = lastFired.get(cooldownKey);
      if (last !== undefined && (cooldown === Infinity || t - last < cooldown)) {
        return false;
      }
      const priority = TRIGGER_PRIORITY[trigger];
      if (priority !== "critical" && !BUCKET_EXEMPT.has(trigger)) {
        while (bucket.length > 0 && t - bucket[0] > GLOBAL_WINDOW_MS) bucket.shift();
        if (bucket.length >= GLOBAL_MAX) return false;
        bucket.push(t);
      }
      lastFired.set(cooldownKey, t);
      return true;
    },
  };
}

/**
 * Weighted random pick from a trigger's pack. Every line starts at weight 1;
 * personality adds `(stat / 10) × lineWeight` per stat, so a snark-10 pet
 * strongly favors snarky lines but never loses access to the rest.
 */
export function pickLine(
  trigger: PetTrigger,
  personality: PetPersonality,
  ctx: PetLineCtx,
  rand: () => number = Math.random,
): string | null {
  const lines = PET_LINES[trigger];
  if (!lines || lines.length === 0) return null;
  const scores = lines.map((line) => {
    let score = 1;
    if (line.weights) {
      for (const stat of Object.keys(line.weights) as (keyof PetPersonality)[]) {
        score += (personality[stat] / 10) * (line.weights[stat] ?? 0);
      }
    }
    return score;
  });
  const total = scores.reduce((sum, s) => sum + s, 0);
  let r = rand() * total;
  let picked = lines[lines.length - 1];
  for (let i = 0; i < lines.length; i++) {
    r -= scores[i];
    if (r <= 0) {
      picked = lines[i];
      break;
    }
  }
  return typeof picked.text === "function" ? picked.text(ctx) : picked.text;
}

/** How long a bubble stays up — a base plus reading time for longer lines. */
export function bubbleDurationMs(text: string): number {
  return 4_500 + 40 * text.length;
}

const PROMPT_PATTERNS: ReadonlyArray<[RegExp, PetTrigger]> = [
  [/\b(fix|bug|broken|crash)/i, "prompt-fix"],
  [/\btest(s|ing)?\b/i, "prompt-test"],
  [/\brefactor/i, "prompt-refactor"],
  [/\b(deploy|release|ship)\b/i, "prompt-deploy"],
];

/** Map a submitted prompt's snippet to a flavor trigger (first match wins). */
export function classifyPromptSnippet(snippet: string): PetTrigger | null {
  for (const [pattern, trigger] of PROMPT_PATTERNS) {
    if (pattern.test(snippet)) return trigger;
  }
  return null;
}
