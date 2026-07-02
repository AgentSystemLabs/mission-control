import * as os from "node:os";
import {
  buildAiPrintInvocation,
  type AiModelId,
  type AiRuntimeHarness,
} from "~/shared/ai-runtime-defaults";
import type { RefineAnnotationInput } from "~/shared/markdown-refine";
import { runCli } from "./claude-cli";

// Rewrites a markdown document per a set of reviewer comments by spawning the
// configured agent CLI in print mode (the same one-shot pattern title-generator.ts uses).
// The buildRefinePrompt / parseRefinedOutput helpers are pure and exported so
// the prompt shape and the output cleanup are unit-testable without spawning a CLI.

// Whole-file rewrites of large docs can take a while; give the model more room
// than the default 60s headless budget.
const REFINE_TIMEOUT_MS = 120_000;

// The document + notes are untrusted (a .md can come from a cloned/downloaded
// repo). We don't pass --dangerously-skip-permissions, so tool calls needing
// approval are auto-denied in headless mode; running in a neutral temp cwd
// additionally avoids inheriting a project's permissive .claude/settings.
// This is a defense-in-depth bound, not a substitute for treating the CLI as
// trusted — see the "refine as pure text transform" note.
const MAX_CONCURRENT_REFINES = 3;
let inFlightRefines = 0;

export function buildRefinePrompt(content: string, annotations: RefineAnnotationInput[]): string {
  const commentList = annotations
    .map((a, i) => {
      const range =
        a.lineEnd > a.lineStart ? `lines ${a.lineStart}-${a.lineEnd}` : `line ${a.lineStart}`;
      const near = a.quote ? `\n   Near: "${a.quote}"` : "";
      return `${i + 1}. [${range}]${near}\n   Comment: ${a.note}`;
    })
    .join("\n");

  return [
    "You are editing a Markdown document based on reviewer comments, like resolving Google Docs comments.",
    "Apply every comment's requested change. Preserve the document's existing structure, wording, and",
    "formatting everywhere the comments do NOT ask for a change. Do not invent unrelated edits.",
    "",
    "Output rules — follow EXACTLY:",
    "- Return ONLY the complete, rewritten Markdown document.",
    "- Do NOT wrap it in code fences.",
    "- Do NOT add any preamble, explanation, or trailing commentary.",
    "",
    "Reviewer comments (each references a line range in the ORIGINAL document below):",
    commentList,
    "",
    "----- ORIGINAL DOCUMENT START -----",
    content,
    "----- ORIGINAL DOCUMENT END -----",
    "",
    "Now output the full rewritten Markdown document, and nothing else.",
  ].join("\n");
}

/**
 * Clean the CLI's stdout back into a bare markdown document. Strips a single
 * outer ```` ```markdown ```` / ```` ```md ```` / ```` ``` ```` wrapper when the
 * model ignored the "no fences" instruction, but leaves genuine fenced code
 * blocks inside the doc untouched.
 */
export function parseRefinedOutput(raw: string): string {
  const trimmed = raw.trim();
  const lines = trimmed.split("\n");
  if (lines.length >= 2) {
    const first = lines[0]!.trim();
    const last = lines[lines.length - 1]!.trim();
    if (/^```(?:markdown|md)?$/i.test(first) && last === "```") {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}

export async function refineMarkdown(params: {
  content: string;
  annotations: RefineAnnotationInput[];
  harness: AiRuntimeHarness;
  model: AiModelId | null;
  cwd?: string;
}): Promise<string> {
  if (inFlightRefines >= MAX_CONCURRENT_REFINES) {
    throw new Error("Too many refine requests in progress. Try again in a moment.");
  }
  inFlightRefines++;
  try {
    const prompt = buildRefinePrompt(params.content, params.annotations);
    const invocation = buildAiPrintInvocation(params.harness, prompt, params.model);

    const raw = await runCli(invocation.cmd, invocation.args, {
      cwd: params.cwd ?? os.tmpdir(),
      timeoutMs: REFINE_TIMEOUT_MS,
    });
    const refined = parseRefinedOutput(raw);
    if (!refined.trim()) {
      throw new Error("The model returned an empty document.");
    }
    return refined;
  } finally {
    inFlightRefines--;
  }
}
