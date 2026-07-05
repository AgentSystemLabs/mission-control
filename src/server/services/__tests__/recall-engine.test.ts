import { describe, expect, it } from "vitest";
import { MEMORY_AUTO_CAPTURE_PER_SESSION_MAX } from "~/shared/project-memory";
import {
  buildDistillPrompt,
  buildVerifyPrompt,
  parseDistillOutput,
  parseVerifyOutput,
} from "../recall-engine";

describe("recall-engine buildDistillPrompt", () => {
  it("includes session context and the allowed type ids", () => {
    const prompt = buildDistillPrompt({
      taskTitle: "Fix auth redirect",
      prompts: ["the auth flow lives in useAuth", "we chose JWT over cookies"],
      projectName: "acme",
      branch: "feat/auth",
    });
    expect(prompt).toContain("Fix auth redirect");
    expect(prompt).toContain("acme");
    expect(prompt).toContain("feat/auth");
    expect(prompt).toContain("useAuth");
    expect(prompt).toContain("decision");
    expect(prompt).toContain("SESSION START");
  });

  it("truncates an oversized transcript to the tail", () => {
    const big = "x".repeat(20_000);
    const prompt = buildDistillPrompt({ taskTitle: "t", prompts: [big] });
    // The prompt still fits well under the raw transcript size.
    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt).toContain("…");
  });
});

describe("recall-engine parseDistillOutput", () => {
  it("parses well-formed blocks into typed candidates", () => {
    const raw = [
      "TYPE: decision",
      "TITLE: Use JWT instead of session cookies",
      "BODY: Chosen for statelessness across the worker fleet.",
      "---",
      "TYPE: architecture",
      "TITLE: Auth flow lives in useAuth",
      "BODY:",
    ].join("\n");
    const out = parseDistillOutput(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      type: "decision",
      title: "Use JWT instead of session cookies",
      body: "Chosen for statelessness across the worker fleet.",
    });
    expect(out[1]).toEqual({
      type: "architecture",
      title: "Auth flow lives in useAuth",
      body: "",
    });
  });

  it("ignores preamble/postamble and invalid types", () => {
    const raw = [
      "Here are the facts I found:",
      "TYPE: not-a-real-type",
      "TITLE: should be dropped",
      "---",
      "TYPE: stack",
      "TITLE: Electron + SQLite + Drizzle",
      "That's everything.",
    ].join("\n");
    const out = parseDistillOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("stack");
  });

  it("returns nothing for NONE", () => {
    expect(parseDistillOutput("NONE")).toEqual([]);
    expect(parseDistillOutput("  none  \n")).toEqual([]);
    expect(parseDistillOutput("")).toEqual([]);
  });

  it("dedupes by type+title and caps to the per-session budget", () => {
    const blocks: string[] = [];
    // Two identical, then more than the cap of distinct facts.
    blocks.push("TYPE: discovery\nTITLE: Same thing\nBODY:");
    blocks.push("TYPE: discovery\nTITLE: same thing\nBODY: dup");
    for (let i = 0; i < MEMORY_AUTO_CAPTURE_PER_SESSION_MAX + 3; i++) {
      blocks.push(`TYPE: discovery\nTITLE: Fact number ${i}\nBODY:`);
    }
    const out = parseDistillOutput(blocks.join("\n---\n"));
    expect(out.length).toBe(MEMORY_AUTO_CAPTURE_PER_SESSION_MAX);
    // The duplicate collapsed to a single entry.
    const sames = out.filter((m) => m.title.toLowerCase() === "same thing");
    expect(sames.length).toBe(1);
  });

  it("strips placeholder bodies and surrounding quotes on titles", () => {
    const raw = 'TYPE: convention\nTITLE: "Prefer named exports"\nBODY: N/A';
    const out = parseDistillOutput(raw);
    expect(out[0]).toEqual({ type: "convention", title: "Prefer named exports", body: "" });
  });
});

describe("recall-engine buildVerifyPrompt", () => {
  it("embeds the stored fact and the verdict contract", () => {
    const prompt = buildVerifyPrompt({ type: "decision", title: "Use JWT", body: "stateless" });
    expect(prompt).toContain("Use JWT");
    expect(prompt).toContain("stateless");
    expect(prompt).toContain("VERDICT:");
    expect(prompt).toContain("contradicted");
  });
});

describe("recall-engine parseVerifyOutput", () => {
  it("parses a verified verdict", () => {
    expect(parseVerifyOutput("VERDICT: verified")).toEqual({ verdict: "verified" });
  });

  it("parses a stale verdict, ignoring surrounding noise", () => {
    expect(parseVerifyOutput("VERDICT: stale\ncould not find it")).toEqual({ verdict: "stale" });
  });

  it("parses a contradicted verdict with the corrected fact", () => {
    const raw = ["VERDICT: contradicted", "TITLE: Use tRPC instead", "BODY: end-to-end types"].join("\n");
    expect(parseVerifyOutput(raw)).toEqual({
      verdict: "contradicted",
      correctedTitle: "Use tRPC instead",
      correctedBody: "end-to-end types",
    });
  });

  it("downgrades a contradicted verdict without a usable title to stale", () => {
    expect(parseVerifyOutput("VERDICT: contradicted")).toEqual({ verdict: "stale" });
  });

  it("strips a placeholder body and surrounding quotes on the corrected title", () => {
    const raw = 'VERDICT: contradicted\nTITLE: "Use Postgres"\nBODY: N/A';
    expect(parseVerifyOutput(raw)).toEqual({
      verdict: "contradicted",
      correctedTitle: "Use Postgres",
      correctedBody: "",
    });
  });

  it("falls back to skipped on unrecognized or empty output", () => {
    expect(parseVerifyOutput("I could not determine this")).toEqual({ verdict: "skipped" });
    expect(parseVerifyOutput("")).toEqual({ verdict: "skipped" });
  });
});
