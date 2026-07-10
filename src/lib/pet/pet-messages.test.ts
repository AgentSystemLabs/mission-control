import { describe, expect, it } from "vitest";
import type { PetPersonality } from "~/shared/pet";
import {
  calendarTriggers,
  classifyPromptSnippet,
  createRateLimiter,
  pickLine,
} from "./pet-messages";
import { PET_LINES } from "./pet-lines";

const neutral: PetPersonality = { snark: 5, wisdom: 5, chaos: 5, zen: 5 };
const ctx = { name: "Pixel", level: 2, runningCount: 3 };

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
    const ctx = { name: "Pixel", level: 3, runningCount: 2 };
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
