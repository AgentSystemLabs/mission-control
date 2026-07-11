import type { PetPersonality, PetSpeciesId } from "~/shared/pet";
import { PET_LINES } from "./pet-lines";

/**
 * Mission Pet message plumbing: which triggers exist, how loud each one is,
 * how often it may fire, and how a line is picked from the packs. Pure and
 * clock-injectable so the rate limiter and picker are unit-testable.
 */

export type PetMessagePriority = "critical" | "info" | "flavor";

export type PetTrigger =
  // lifecycle + core activity
  | "hatch"
  | "greeting"
  | "session-finished"
  | "session-finished-long"
  | "session-milestone"
  | "needs-input"
  | "ship-committing"
  | "ship-pushing"
  | "ship-success"
  | "ship-failure"
  // consecutive-failure escalation tiers (3 / 5 / 10 / 20 straight losses)
  | "error-streak"
  | "error-streak-5"
  | "error-streak-10"
  | "error-streak-20"
  // first win after a rough patch, flavored by what kept failing
  | "comeback"
  | "comeback-ship"
  | "comeback-interrupted"
  | "pr-created"
  | "multi-agent"
  | "memory-learned"
  | "graph-indexed"
  | "worktree-created"
  | "project-created"
  | "diagram-show"
  | "interrupted"
  | "idle"
  | "petting"
  | "overpet"
  | "level-up"
  // clock + calendar
  | "night"
  | "early-morning"
  | "friday"
  | "weekend"
  | "monday"
  | "long-session"
  | "marathon"
  | "new-year"
  | "valentines"
  | "pi-day"
  | "april-fools"
  | "halloween"
  | "christmas"
  | "new-years-eve"
  | "spooky-season"
  // context combos — a base trigger landing at a telling hour or weekday
  | "night-commit"
  | "night-failure"
  | "friday-push"
  | "weekend-commit"
  // the user addressed the pet by name in a prompt
  | "name-mentioned"
  // prompt keyword flavor (what you're asking the agents to do)
  | "prompt-sent"
  | "prompt-fix"
  | "prompt-test"
  | "prompt-test-fail"
  | "prompt-refactor"
  | "prompt-deploy"
  | "prompt-merge-conflict"
  | "prompt-rebase"
  | "prompt-branch"
  | "prompt-lint"
  | "prompt-types"
  | "prompt-build"
  | "prompt-security"
  | "prompt-deps"
  | "prompt-docs"
  | "prompt-env"
  | "prompt-config"
  | "prompt-css"
  | "prompt-sql"
  | "prompt-docker"
  | "prompt-ci"
  | "prompt-regex"
  | "prompt-delete"
  | "prompt-create"
  | "prompt-todo"
  // prompt language flavor
  | "prompt-python"
  | "prompt-typescript"
  | "prompt-rust"
  | "prompt-go"
  | "prompt-java"
  | "prompt-ruby"
  | "prompt-php"
  | "prompt-cpp"
  | "prompt-haskell"
  | "prompt-swift"
  | "prompt-kotlin"
  | "prompt-elixir"
  | "prompt-zig";

export type PetLineCtx = {
  name: string;
  level: number;
  runningCount: number;
  /** Sessions finished since app boot — feeds the milestone lines. */
  sessionsFinished: number;
  /** The active species — species-tagged lines are its native voice. */
  species: PetSpeciesId;
};

export type PetLine = {
  text: string | ((ctx: PetLineCtx) => string);
  /** Personality stats that make this line more likely (see pickLine). */
  weights?: Partial<PetPersonality>;
  /** Restricts the line to these species and boosts it for them (see pickLine). */
  species?: readonly PetSpeciesId[];
};

type TriggerMeta = {
  priority: PetMessagePriority;
  /** ms between firings; Infinity = once per app boot (the limiter is module-lifetime). */
  cooldownMs: number;
};

const ONCE_PER_BOOT = Infinity;
// A prompt-send acknowledgment fires often but not on every rapid-fire send;
// the excited hop still plays each time (that's a flourish, not a bubble).
const PROMPT_SENT_COOLDOWN = 20_000;
const PROMPT_FLAVOR_COOLDOWN = 90_000;
const PROMPT_LANG_COOLDOWN = 600_000;

/**
 * critical — the user should act (blocked agent, failed ship). Preempts a
 * visible bubble and bypasses the global bucket.
 * info — worth a glance; flavor — pure ambience, first to be dropped.
 */
const TRIGGER_META: Record<PetTrigger, TriggerMeta> = {
  hatch: { priority: "info", cooldownMs: ONCE_PER_BOOT },
  greeting: { priority: "info", cooldownMs: ONCE_PER_BOOT },
  "session-finished": { priority: "info", cooldownMs: 45_000 },
  "session-finished-long": { priority: "info", cooldownMs: 45_000 },
  // Fires only at exact milestone counts, so the store gates it, not the clock.
  "session-milestone": { priority: "info", cooldownMs: 0 },
  "needs-input": { priority: "critical", cooldownMs: 60_000 },
  "ship-committing": { priority: "info", cooldownMs: 30_000 },
  "ship-pushing": { priority: "info", cooldownMs: 30_000 },
  "ship-success": { priority: "info", cooldownMs: 30_000 },
  "ship-failure": { priority: "critical", cooldownMs: 30_000 },
  "error-streak": { priority: "critical", cooldownMs: 120_000 },
  "error-streak-5": { priority: "critical", cooldownMs: 120_000 },
  "error-streak-10": { priority: "critical", cooldownMs: 120_000 },
  "error-streak-20": { priority: "critical", cooldownMs: 120_000 },
  comeback: { priority: "info", cooldownMs: 60_000 },
  "comeback-ship": { priority: "info", cooldownMs: 60_000 },
  "comeback-interrupted": { priority: "info", cooldownMs: 60_000 },
  "pr-created": { priority: "info", cooldownMs: 300_000 },
  "multi-agent": { priority: "flavor", cooldownMs: 600_000 },
  "memory-learned": { priority: "flavor", cooldownMs: 300_000 },
  "graph-indexed": { priority: "flavor", cooldownMs: 300_000 },
  "worktree-created": { priority: "flavor", cooldownMs: 300_000 },
  "project-created": { priority: "flavor", cooldownMs: 600_000 },
  "diagram-show": { priority: "flavor", cooldownMs: 300_000 },
  interrupted: { priority: "info", cooldownMs: 60_000 },
  idle: { priority: "flavor", cooldownMs: 900_000 },
  petting: { priority: "info", cooldownMs: 20_000 },
  // The spam-click complaint — short cooldown so a stubborn clicker gets a
  // second line once the first bubble has cleared.
  overpet: { priority: "info", cooldownMs: 15_000 },
  "level-up": { priority: "info", cooldownMs: 0 },
  night: { priority: "flavor", cooldownMs: 1_800_000 },
  "early-morning": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  friday: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  weekend: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  monday: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  "long-session": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  marathon: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  "new-year": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  valentines: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  "pi-day": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  "april-fools": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  halloween: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  christmas: { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  "new-years-eve": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  "spooky-season": { priority: "flavor", cooldownMs: ONCE_PER_BOOT },
  // Combos keep the base trigger's loudness; long cooldowns stop the joke
  // wearing out over one late-night or weekend stretch.
  "night-commit": { priority: "info", cooldownMs: 3_600_000 },
  "night-failure": { priority: "critical", cooldownMs: 3_600_000 },
  "friday-push": { priority: "info", cooldownMs: ONCE_PER_BOOT },
  "weekend-commit": { priority: "info", cooldownMs: ONCE_PER_BOOT },
  // Typing the pet's name is deliberate — it always answers, like petting.
  "name-mentioned": { priority: "info", cooldownMs: 0 },
  "prompt-sent": { priority: "flavor", cooldownMs: PROMPT_SENT_COOLDOWN },
  "prompt-fix": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-test": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-test-fail": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-refactor": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-deploy": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-merge-conflict": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-rebase": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-branch": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-lint": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-types": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-build": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-security": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-deps": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-docs": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-env": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-config": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-css": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-sql": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-docker": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-ci": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-regex": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-delete": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-create": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-todo": { priority: "flavor", cooldownMs: PROMPT_FLAVOR_COOLDOWN },
  "prompt-python": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-typescript": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-rust": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-go": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-java": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-ruby": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-php": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-cpp": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-haskell": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-swift": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-kotlin": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-elixir": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
  "prompt-zig": { priority: "flavor", cooldownMs: PROMPT_LANG_COOLDOWN },
};

export const TRIGGER_PRIORITY: Record<PetTrigger, PetMessagePriority> = Object.fromEntries(
  Object.entries(TRIGGER_META).map(([k, v]) => [k, v.priority]),
) as Record<PetTrigger, PetMessagePriority>;

// The global bucket keeps the pet charming instead of noisy: at most this many
// non-exempt messages inside a sliding window. Critical triggers and direct
// responses to the user (petting, level-up) don't count against it.
const GLOBAL_WINDOW_MS = 600_000;
const GLOBAL_MAX = 6;
const BUCKET_EXEMPT: ReadonlySet<PetTrigger> = new Set([
  "petting",
  "overpet",
  "level-up",
  "name-mentioned",
]);

export function createRateLimiter(now: () => number = Date.now): {
  allow(trigger: PetTrigger, key?: string): boolean;
} {
  const lastFired = new Map<string, number>();
  const bucket: number[] = [];
  return {
    /** `key` scopes the cooldown (e.g. needs-input per taskId). */
    allow(trigger, key) {
      const t = now();
      const cooldown = TRIGGER_META[trigger].cooldownMs;
      const cooldownKey = key ? `${trigger}:${key}` : trigger;
      const last = lastFired.get(cooldownKey);
      if (last !== undefined && (cooldown === Infinity || t - last < cooldown)) {
        return false;
      }
      const priority = TRIGGER_META[trigger].priority;
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

/** Extra selection weight a species-tagged line gets for its own species. */
const SPECIES_VOICE_BOOST = 2;

/**
 * Weighted random pick from a trigger's pack. Every line starts at weight 1;
 * personality adds `(stat / 10) × lineWeight` per stat, so a snark-10 pet
 * strongly favors snarky lines but never loses access to the rest.
 * Species-tagged lines exist only for their species (never leak to others)
 * and get a flat boost there — they're that species' native voice.
 */
export function pickLine(
  trigger: PetTrigger,
  personality: PetPersonality,
  ctx: PetLineCtx,
  rand: () => number = Math.random,
): string | null {
  const pack = PET_LINES[trigger];
  if (!pack || pack.length === 0) return null;
  const lines = pack.filter((line) => !line.species || line.species.includes(ctx.species));
  if (lines.length === 0) return null;
  const scores = lines.map((line) => {
    let score = 1 + (line.species ? SPECIES_VOICE_BOOST : 0);
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

// Ordered — first match wins, so the urgent categories sit on top. All of
// this reads the first 200 chars of the submitted prompt (the SSE snippet).
const PROMPT_PATTERNS: ReadonlyArray<[RegExp, PetTrigger]> = [
  [/\b(fix|bug|broken|crash)/i, "prompt-fix"],
  [/\b(fail(ing|ed|s)?\s+tests?|tests?\s+(are\s+)?fail)/i, "prompt-test-fail"],
  [/\b(test(s|ing)?|coverage)\b/i, "prompt-test"],
  [/\brefactor/i, "prompt-refactor"],
  [/\bmerge\s+conflict|conflict(s|ed)?\b.*\bmerge/i, "prompt-merge-conflict"],
  [/\brebase/i, "prompt-rebase"],
  [/\bbranch\b/i, "prompt-branch"],
  [/\b(deploy|release|ship)\b/i, "prompt-deploy"],
  [/\b(lint|eslint|prettier|format(ting)?)\b/i, "prompt-lint"],
  [/\b(type\s?error|typecheck|type\s+safety|typings?)\b/i, "prompt-types"],
  [/\b(build\s+(fail|break|error)|fix\s+the\s+build|compil(e|ation))\b/i, "prompt-build"],
  [/\b(security|vulnerab|xss|csrf|injection|exploit)/i, "prompt-security"],
  [/\b(dependenc|package\.json|lockfile|node_modules|upgrade\s+\w+\s+to|deprecat)/i, "prompt-deps"],
  [/\b(docs?|documentation|readme|changelog)\b/i, "prompt-docs"],
  [/\b(\.env|env\s+var|environment\s+variable|secret(s)?\b)/i, "prompt-env"],
  [/\b(config(uration)?|settings\s+file|yaml|toml)\b/i, "prompt-config"],
  [/\b(css|stylesheet|tailwind|styling|center\s+a?\s?div)\b/i, "prompt-css"],
  [/\b(sql|database|migration|postgres|sqlite|query)\b/i, "prompt-sql"],
  [/\b(docker|container|dockerfile|compose)\b/i, "prompt-docker"],
  [/\b(ci\b|pipeline|github\s+actions?|workflow\s+file)/i, "prompt-ci"],
  [/\b(regex|regular\s+expression)\b/i, "prompt-regex"],
  [/\btodo|fixme\b/i, "prompt-todo"],
  [/\b(delete|remove)\b/i, "prompt-delete"],
  [/\b(create|scaffold|new\s+file)\b/i, "prompt-create"],
  // languages last — they flavor rather than characterize the task
  [/\bpython|\.py\b/i, "prompt-python"],
  [/\btypescript|\.tsx?\b/i, "prompt-typescript"],
  [/\brust|\.rs\b|cargo\b/i, "prompt-rust"],
  [/\bgolang\b|\bgo\s+(code|file|module|service)/i, "prompt-go"],
  [/\bjava\b(?!script)/i, "prompt-java"],
  [/\bruby|\.rb\b|rails\b/i, "prompt-ruby"],
  [/\bphp\b|laravel\b/i, "prompt-php"],
  [/\bc\+\+|cpp\b/i, "prompt-cpp"],
  [/\bhaskell\b/i, "prompt-haskell"],
  [/\bswift(ui)?\b/i, "prompt-swift"],
  [/\bkotlin\b/i, "prompt-kotlin"],
  [/\belixir\b|phoenix\b/i, "prompt-elixir"],
  [/\bzig\b/i, "prompt-zig"],
];

/**
 * Whole-word, case-insensitive check for the pet's name in a prompt snippet.
 * Word boundaries are "not a letter" rather than \b so names ending in
 * digits or symbols ("Mochi2", "C-3PO") still terminate cleanly.
 */
export function mentionsPetName(snippet: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z])${escaped}([^a-zA-Z]|$)`, "i").test(snippet);
}

/** Map a submitted prompt's snippet to a flavor trigger (first match wins). */
export function classifyPromptSnippet(snippet: string): PetTrigger | null {
  for (const [pattern, trigger] of PROMPT_PATTERNS) {
    if (pattern.test(snippet)) return trigger;
  }
  return null;
}

/**
 * Calendar triggers the controller checks once per boot (and on day rollover).
 * Returned in priority order — the caller fires the first the limiter allows.
 */
export function calendarTriggers(now: Date): PetTrigger[] {
  const out: PetTrigger[] = [];
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = now.getDay();
  const hour = now.getHours();
  if (month === 1 && day === 1) out.push("new-year");
  if (month === 2 && day === 14) out.push("valentines");
  if (month === 3 && day === 14) out.push("pi-day");
  if (month === 4 && day === 1) out.push("april-fools");
  if (month === 10 && day === 31) out.push("halloween");
  else if (month === 10) out.push("spooky-season");
  if (month === 12 && day === 25) out.push("christmas");
  if (month === 12 && day === 31) out.push("new-years-eve");
  if (weekday === 5) out.push("friday");
  if (weekday === 0 || weekday === 6) out.push("weekend");
  if (weekday === 1) out.push("monday");
  if (hour >= 6 && hour < 9) out.push("early-morning");
  return out;
}

/**
 * Context × event combos — the same trigger lands differently at 2am or on a
 * Friday. Returns the sharper trigger when the clock agrees, else null; the
 * caller falls back to the base pack once the combo's cooldown has spent it.
 */
export function comboTrigger(base: PetTrigger, now: Date): PetTrigger | null {
  const weekday = now.getDay();
  const hour = now.getHours();
  const night = hour >= 22 || hour < 6;
  if (night && base === "ship-committing") return "night-commit";
  if (night && base === "ship-failure") return "night-failure";
  if (base === "ship-pushing" && weekday === 5) return "friday-push";
  if (base === "ship-committing" && (weekday === 0 || weekday === 6)) return "weekend-commit";
  return null;
}
