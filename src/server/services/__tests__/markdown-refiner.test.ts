import { describe, expect, it } from "vitest";
import { buildRefinePrompt, parseRefinedOutput } from "../markdown-refiner";
import { buildAiPrintInvocation } from "~/shared/ai-runtime-defaults";
import type { RefineAnnotationInput } from "~/shared/markdown-refine";

const ANNOTATIONS: RefineAnnotationInput[] = [
  { lineStart: 3, lineEnd: 3, quote: "First paragraph.", note: "shorten this" },
  { lineStart: 8, lineEnd: 10, quote: "The install steps", note: "add a node version note" },
];

describe("buildRefinePrompt", () => {
  it("embeds the document and every comment with its line range + note", () => {
    const prompt = buildRefinePrompt("# Doc\n\nbody", ANNOTATIONS);
    expect(prompt).toContain("# Doc\n\nbody");
    expect(prompt).toContain("[line 3]");
    expect(prompt).toContain("[lines 8-10]");
    expect(prompt).toContain("shorten this");
    expect(prompt).toContain("add a node version note");
    expect(prompt).toContain('Near: "First paragraph."');
  });

  it("instructs the model to return only the document with no fences", () => {
    const prompt = buildRefinePrompt("x", ANNOTATIONS);
    expect(prompt).toMatch(/Return ONLY the complete, rewritten Markdown document/i);
    expect(prompt).toMatch(/Do NOT wrap it in code fences/i);
  });
});

describe("parseRefinedOutput", () => {
  it("returns trimmed content unchanged when there is no outer fence", () => {
    expect(parseRefinedOutput("\n# Title\n\nBody\n")).toBe("# Title\n\nBody");
  });

  it("strips a ```markdown wrapper the model added despite instructions", () => {
    const raw = "```markdown\n# Title\n\nBody\n```";
    expect(parseRefinedOutput(raw)).toBe("# Title\n\nBody");
  });

  it("strips a bare ``` wrapper", () => {
    expect(parseRefinedOutput("```\n# Title\n```")).toBe("# Title");
  });

  it("preserves internal fenced code blocks", () => {
    const doc = "# Title\n\n```ts\nconst x = 1;\n```\n\nDone";
    expect(parseRefinedOutput(doc)).toBe(doc);
  });

  it("does not strip when only the first line is a fence", () => {
    const raw = "```\ncode line\nno closing fence";
    expect(parseRefinedOutput(raw)).toBe("```\ncode line\nno closing fence");
  });
});

describe("buildAiPrintInvocation", () => {
  it("builds one-shot markdown refine invocations with harness-specific commands", () => {
    expect(buildAiPrintInvocation("codex", "rewrite", "gpt-5.3-codex")).toEqual({
      cmd: "codex",
      args: ["exec", "--model", "gpt-5.3-codex", "rewrite"],
    });
    expect(buildAiPrintInvocation("cursor-cli", "rewrite", "gpt-5.3-codex")).toEqual({
      cmd: "cursor-agent",
      args: ["-p", "--trust", "--mode", "ask", "--model", "gpt-5.3-codex", "rewrite"],
    });
    expect(
      buildAiPrintInvocation("opencode", "rewrite", "anthropic/claude-sonnet-4-5"),
    ).toEqual({
      cmd: "opencode",
      args: ["run", "--model", "anthropic/claude-sonnet-4-5", "rewrite"],
    });
  });
});
