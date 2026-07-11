import { describe, expect, it } from "vitest";
import type { PetPersonality } from "~/shared/pet";
import {
  calendarTriggers,
  classifyPromptSnippet,
  comboTrigger,
  createRateLimiter,
  mentionsPetName,
  parsePetCommand,
  pickLine,
  type PetLineCtx,
} from "./pet-messages";
import { PET_LINES } from "./pet-lines";

const neutral: PetPersonality = { snark: 5, wisdom: 5, chaos: 5, zen: 5 };
const ctx: PetLineCtx = {
  name: "Pixel",
  level: 2,
  prestige: 0,
  runningCount: 3,
  sessionsFinished: 5,
  species: "mochi",
  uncommittedCount: 12,
  favoriteProject: "mission-control",
  ageDays: 400,
  weekly: { sessions: 4, ships: 2, prs: 1, failures: 1 },
};

describe("createRateLimiter", () => {
  it("enforces per-trigger cooldowns", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    expect(limiter.allow("session-finished")).toBe(true);
    t += 10_000;
    expect(limiter.allow("session-finished")).toBe(false);
    t += 40_000; // 50s total > 45s cooldown
    expect(limiter.allow("session-finished")).toBe(true);
  });

  it("scopes cooldowns by key", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    expect(limiter.allow("needs-input", "task-a")).toBe(true);
    expect(limiter.allow("needs-input", "task-b")).toBe(true);
    expect(limiter.allow("needs-input", "task-a")).toBe(false);
  });

  it("allows greeting exactly once", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    expect(limiter.allow("greeting")).toBe(true);
    t += 100 * 60_000;
    expect(limiter.allow("greeting")).toBe(false);
  });

  it("drops the 7th non-critical message inside the 10-minute bucket", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    const flavors = [
      "prompt-fix",
      "prompt-test",
      "prompt-refactor",
      "prompt-deploy",
      "memory-learned",
      "graph-indexed",
    ] as const;
    for (const trigger of flavors) {
      t += 1_000;
      expect(limiter.allow(trigger)).toBe(true);
    }
    t += 1_000;
    expect(limiter.allow("idle")).toBe(false); // bucket full
    t += 600_000; // window slides past
    expect(limiter.allow("idle")).toBe(true);
  });

  it("lets critical triggers and petting bypass a full bucket", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    const flavors = [
      "prompt-fix",
      "prompt-test",
      "prompt-refactor",
      "prompt-deploy",
      "memory-learned",
      "graph-indexed",
    ] as const;
    for (const trigger of flavors) {
      t += 1_000;
      limiter.allow(trigger);
    }
    t += 1_000;
    expect(limiter.allow("needs-input", "task-x")).toBe(true); // critical
    expect(limiter.allow("ship-failure")).toBe(true); // critical
    expect(limiter.allow("petting")).toBe(true); // exempt
    expect(limiter.allow("level-up")).toBe(true); // exempt
  });

  it("name-mentioned has no cooldown and bypasses a full bucket", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    const flavors = [
      "prompt-fix",
      "prompt-test",
      "prompt-refactor",
      "prompt-deploy",
      "memory-learned",
      "graph-indexed",
    ] as const;
    for (const trigger of flavors) {
      t += 1_000;
      limiter.allow(trigger);
    }
    expect(limiter.allow("name-mentioned")).toBe(true);
    expect(limiter.allow("name-mentioned")).toBe(true); // back-to-back
  });
});

describe("pickLine", () => {
  it("is deterministic with an injected rand", () => {
    const a = pickLine("session-finished", neutral, ctx, () => 0.1);
    const b = pickLine("session-finished", neutral, ctx, () => 0.1);
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("resolves function lines with the context", () => {
    // multi-agent's first line interpolates runningCount; rand 0 picks it.
    const line = pickLine("multi-agent", { snark: 0, wisdom: 0, chaos: 10, zen: 0 }, ctx, () => 0);
    expect(line).toContain("3");
  });

  it("personality weighting shifts the distribution", () => {
    const snarky: PetPersonality = { snark: 10, wisdom: 0, chaos: 0, zen: 0 };
    const zenful: PetPersonality = { snark: 0, wisdom: 0, chaos: 0, zen: 10 };
    const samples = (personality: PetPersonality) => {
      const seen = new Map<string, number>();
      const rand = mulberrylite();
      for (let i = 0; i < 400; i++) {
        const line = pickLine("ship-failure", personality, ctx, rand)!;
        seen.set(line, (seen.get(line) ?? 0) + 1);
      }
      return seen;
    };
    const snarkLine = "Push rejected. The remote said no. Loudly.";
    const zenLine = "Didn't land. Check the log, breathe, retry.";
    expect(samples(snarky).get(snarkLine)! > samples(zenful).get(snarkLine)!).toBe(true);
    expect(samples(zenful).get(zenLine)! > samples(snarky).get(zenLine)!).toBe(true);
  });

  it("never picks another species' native-voice line", () => {
    const foreign = PET_LINES.night
      .filter((line) => line.species && !line.species.includes("mochi"))
      .map((line) => line.text);
    expect(foreign.length).toBeGreaterThan(0);
    const rand = mulberrylite();
    for (let i = 0; i < 300; i++) {
      const line = pickLine("night", neutral, ctx, rand)!;
      expect(foreign).not.toContain(line);
    }
  });

  it("locks minLevel lines below their level and offers them from it", () => {
    const scarfLine = "*adjusts scarf* Right. Where were we.";
    const outputsAt = (level: number) =>
      new Set(
        Array.from({ length: 120 }, (_, i) =>
          pickLine("greeting", neutral, { ...ctx, level }, () => i / 120),
        ),
      );
    expect(outputsAt(1).has(scarfLine)).toBe(false);
    expect(outputsAt(4).has(scarfLine)).toBe(false);
    expect(outputsAt(5).has(scarfLine)).toBe(true);
    expect(outputsAt(10).has(scarfLine)).toBe(true);
  });

  it("locks minPrestige lines until the pet has molted", () => {
    const lapLine = "This isn't my first lap. Let's go.";
    const outputsAt = (prestige: number) =>
      new Set(
        Array.from({ length: 120 }, (_, i) =>
          pickLine("greeting", neutral, { ...ctx, prestige }, () => i / 120),
        ),
      );
    expect(outputsAt(0).has(lapLine)).toBe(false);
    expect(outputsAt(1).has(lapLine)).toBe(true);
  });

  it("evolve lines name the gear for the level just reached", () => {
    const rand = mulberrylite();
    for (let i = 0; i < 60; i++) {
      expect(pickLine("evolve", neutral, { ...ctx, level: 5 }, rand)).toContain("scarf");
    }
    for (let i = 0; i < 60; i++) {
      expect(pickLine("evolve", neutral, { ...ctx, level: 8 }, rand)).toContain("tool belt");
    }
  });

  it("a species regularly speaks in its own voice", () => {
    const rivetTexts = PET_LINES.night
      .filter((line) => line.species?.includes("rivet"))
      .map((line) => line.text);
    expect(rivetTexts.length).toBeGreaterThan(0);
    const rand = mulberrylite();
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const line = pickLine("night", neutral, { ...ctx, species: "rivet" }, rand)!;
      if (rivetTexts.includes(line)) hits += 1;
    }
    // Two boosted lines in a ~13-line pack: well above a no-boost share.
    expect(hits).toBeGreaterThan(30);
  });
});

describe("comboTrigger", () => {
  it("upgrades ship triggers when the clock agrees", () => {
    // 2026-07-17 is a Friday; 07-18 a Saturday; 07-14 a Tuesday.
    const fridayNoon = new Date(2026, 6, 17, 12);
    expect(comboTrigger("ship-pushing", fridayNoon)).toBe("friday-push");
    expect(comboTrigger("ship-committing", fridayNoon)).toBeNull();
    const lateNight = new Date(2026, 6, 15, 23, 30);
    expect(comboTrigger("ship-committing", lateNight)).toBe("night-commit");
    expect(comboTrigger("ship-failure", lateNight)).toBe("night-failure");
    expect(comboTrigger("ship-committing", new Date(2026, 6, 18, 12))).toBe("weekend-commit");
    expect(comboTrigger("ship-pushing", new Date(2026, 6, 14, 12))).toBeNull();
  });

  it("night outranks the weekend for a 2am saturday commit", () => {
    expect(comboTrigger("ship-committing", new Date(2026, 6, 18, 2))).toBe("night-commit");
  });

  it("leaves non-ship triggers alone", () => {
    expect(comboTrigger("session-finished", new Date(2026, 6, 17, 23))).toBeNull();
    expect(comboTrigger("error-streak", new Date(2026, 6, 17, 23))).toBeNull();
  });
});

describe("mentionsPetName", () => {
  it("matches the name as a whole word, case-insensitively", () => {
    expect(mentionsPetName("hey pixel, take a look", "Pixel")).toBe(true);
    expect(mentionsPetName("PIXEL!", "Pixel")).toBe(true);
    expect(mentionsPetName("Pixel", "Pixel")).toBe(true);
    expect(mentionsPetName("ask (pixel) about it", "Pixel")).toBe(true);
  });

  it("ignores the name embedded in another word", () => {
    expect(mentionsPetName("fix the pixels on the canvas", "Pixel")).toBe(false);
    expect(mentionsPetName("subpixel rendering is off", "Pixel")).toBe(false);
  });

  it("never matches an empty or whitespace name", () => {
    expect(mentionsPetName("anything at all", "")).toBe(false);
    expect(mentionsPetName("anything at all", "   ")).toBe(false);
  });

  it("treats regex specials in the name as literals", () => {
    expect(mentionsPetName("hey c++ can you help", "C++")).toBe(true);
    expect(mentionsPetName("hey cpp can you help", "C++")).toBe(false);
    expect(mentionsPetName("paging dr. dot", "Dr. Dot")).toBe(true);
  });
});

describe("parsePetCommand", () => {
  it("maps command verbs, with stats outranking the rest", () => {
    expect(parsePetCommand("pixel, dance for me")).toBe("dance");
    expect(parsePetCommand("Pixel do a little twirl")).toBe("dance");
    expect(parsePetCommand("go to sleep pixel")).toBe("sleep");
    expect(parsePetCommand("pixel take a nap")).toBe("sleep");
    expect(parsePetCommand("sing us a song, pixel")).toBe("sing");
    expect(parsePetCommand("pixel show me your stats")).toBe("stats");
    expect(parsePetCommand("pixel, dance while showing stats")).toBe("stats");
  });

  it("returns null when the mention carries no command", () => {
    expect(parsePetCommand("hey pixel, fix the login crash")).toBeNull();
    expect(parsePetCommand("pixel!")).toBeNull();
  });
});

describe("classifyPromptSnippet", () => {
  it("maps keywords to flavor triggers", () => {
    expect(classifyPromptSnippet("please fix the login crash")).toBe("prompt-fix");
    expect(classifyPromptSnippet("add tests for the parser")).toBe("prompt-test");
    expect(classifyPromptSnippet("refactor the store")).toBe("prompt-refactor");
    expect(classifyPromptSnippet("ship the release")).toBe("prompt-deploy");
    expect(classifyPromptSnippet("add a settings page")).toBeNull();
  });

  it("prefers fix over later categories when both match", () => {
    expect(classifyPromptSnippet("fix the failing tests")).toBe("prompt-fix");
  });

  it("maps the expanded keyword categories", () => {
    expect(classifyPromptSnippet("resolve the merge conflict in api.ts")).toBe(
      "prompt-merge-conflict",
    );
    expect(classifyPromptSnippet("rebase onto main")).toBe("prompt-rebase");
    expect(classifyPromptSnippet("the tests are failing on CI")).toBe("prompt-test-fail");
    expect(classifyPromptSnippet("center a div properly")).toBe("prompt-css");
    expect(classifyPromptSnippet("upgrade dependencies in package.json")).toBe("prompt-deps");
    expect(classifyPromptSnippet("write a dockerfile for the api")).toBe("prompt-docker");
    expect(classifyPromptSnippet("tighten the regex in the parser")).toBe("prompt-regex");
    expect(classifyPromptSnippet("update the readme")).toBe("prompt-docs");
    expect(classifyPromptSnippet("port this module to rust")).toBe("prompt-rust");
    expect(classifyPromptSnippet("audit for sql injection")).toBe("prompt-security");
  });
});

describe("calendarTriggers", () => {
  it("fires date-specific triggers on their dates", () => {
    expect(calendarTriggers(new Date(2026, 9, 31, 12))).toContain("halloween");
    expect(calendarTriggers(new Date(2026, 9, 10, 12))).toContain("spooky-season");
    expect(calendarTriggers(new Date(2026, 11, 25, 12))).toContain("christmas");
    expect(calendarTriggers(new Date(2026, 0, 1, 12))).toContain("new-year");
  });

  it("fires weekday and early-morning triggers", () => {
    // 2026-07-10 is a Friday; 2026-07-13 a Monday.
    expect(calendarTriggers(new Date(2026, 6, 10, 12))).toContain("friday");
    expect(calendarTriggers(new Date(2026, 6, 11, 12))).toContain("weekend");
    const mondayMorning = calendarTriggers(new Date(2026, 6, 13, 7));
    expect(mondayMorning).toContain("monday");
    expect(mondayMorning).toContain("early-morning");
    expect(calendarTriggers(new Date(2026, 6, 15, 12))).toHaveLength(0);
  });

  it("once-per-boot calendar triggers fire exactly once", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    expect(limiter.allow("friday")).toBe(true);
    t += 24 * 60 * 60_000;
    expect(limiter.allow("friday")).toBe(false);
  });
});

describe("PET_LINES coverage", () => {
  it("every trigger has at least one line", () => {
    for (const [trigger, lines] of Object.entries(PET_LINES)) {
      expect(lines.length, `empty pack for ${trigger}`).toBeGreaterThan(0);
    }
  });

  it("every line resolves to non-empty text", () => {
    const ctx: PetLineCtx = {
      name: "Pixel",
      level: 3,
      prestige: 2,
      runningCount: 2,
      sessionsFinished: 10,
      species: "mochi",
      uncommittedCount: 12,
      favoriteProject: "mission-control",
      ageDays: 400,
      weekly: { sessions: 4, ships: 2, prs: 1, failures: 1 },
    };
    for (const lines of Object.values(PET_LINES)) {
      for (const line of lines) {
        const text = typeof line.text === "function" ? line.text(ctx) : line.text;
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

/** Tiny deterministic PRNG so the distribution test is reproducible. */
function mulberrylite(seed = 1234): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
