import * as os from "node:os";
import { buildAiPrintInvocation } from "~/shared/ai-runtime-defaults";
import {
  MEMORY_AUTO_CAPTURE_PER_SESSION_MAX,
  MEMORY_BODY_MAX,
  MEMORY_TITLE_MAX,
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  isMemoryType,
  type MemoryType,
  type MemoryVerifyVerdict,
} from "~/shared/project-memory";
import { runCli } from "./claude-cli";
import { readRecallSettings } from "./recall-settings";

// The Recall engine shells out to a connected agent CLI in print mode (the same
// one-shot pattern title-generator.ts and markdown-refiner.ts use) to distill a
// finished session into a few durable, typed project facts. All generative work
// is optional: when `recallEngineEnabled` is off, callers get an empty result
// and fall back to the deterministic path with no CLI round-trip.
//
// buildDistillPrompt / parseDistillOutput are pure and exported so the prompt
// shape and the parser can be unit-tested without spawning a CLI.

// A whole-session distill can chew through a lot of transcript; give the model
// more room than the 60s headless default but keep it bounded.
const DISTILL_TIMEOUT_MS = 90_000;

// Never feed an unbounded transcript to the CLI — cap the joined prompt text.
const DISTILL_INPUT_CHAR_BUDGET = 8_000;

// Only run one distill at a time. Session finishes can arrive in bursts (e.g.
// closing several worktrees); serializing keeps us from fanning out N CLIs.
const MAX_CONCURRENT_DISTILLS = 2;
let inFlightDistills = 0;

export interface DistilledMemory {
  type: MemoryType;
  title: string;
  body: string;
}

export interface DistillSessionInput {
  taskTitle: string;
  /** The user's recorded prompts for the session, newest last. */
  prompts: string[];
  /** Extra context (branch, project name) folded into the prompt header. */
  projectName?: string;
  branch?: string | null;
}

const ALLOWED_TYPE_LIST = MEMORY_TYPES.map((t) => `${t} (${MEMORY_TYPE_LABELS[t]})`).join(", ");

export function buildDistillPrompt(input: DistillSessionInput): string {
  const transcript = joinPrompts(input.prompts);
  const header = [
    `Project: ${input.projectName ?? "(unknown)"}`,
    input.branch ? `Branch: ${input.branch}` : null,
    `Session: ${input.taskTitle}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "You are curating long-term project memory from a finished coding session.",
    "Extract ONLY durable, reusable facts about THIS PROJECT that would help a future",
    "session start faster: architecture, decisions and their rationale, conventions,",
    "stack details, glossary terms, known issues, and useful discoveries.",
    "",
    "Rules:",
    `- Output at most ${MEMORY_AUTO_CAPTURE_PER_SESSION_MAX} facts. Fewer is better — skip anything transient.`,
    "- Do NOT record the task itself, TODOs, chit-chat, or anything specific to one run.",
    "- Each fact must stand on its own without the session context.",
    `- Pick the single best type for each fact from: ${ALLOWED_TYPE_LIST}.`,
    "",
    "Output format — for EACH fact emit exactly these three lines:",
    "TYPE: <one type id from the list above>",
    "TITLE: <a short headline, no trailing punctuation>",
    "BODY: <one line of detail, or leave empty>",
    "Separate facts with a line containing only ---",
    "Output nothing else — no preamble, no numbering, no code fences.",
    "If there is nothing durable worth remembering, output the single word NONE.",
    "",
    "----- SESSION START -----",
    header,
    "",
    transcript,
    "----- SESSION END -----",
  ].join("\n");
}

function joinPrompts(prompts: string[]): string {
  const joined = prompts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
  if (joined.length <= DISTILL_INPUT_CHAR_BUDGET) return joined;
  // Keep the tail — the latest prompts are the most representative of outcomes.
  return "…\n" + joined.slice(joined.length - DISTILL_INPUT_CHAR_BUDGET);
}

function fieldValue(block: string, field: "TYPE" | "TITLE" | "BODY" | "VERDICT"): string {
  const matches = [...block.matchAll(new RegExp(`^\\s*${field}\\s*[:=]\\s*(.*)$`, "gim"))];
  if (!matches.length) return "";
  return (matches[matches.length - 1]![1] ?? "").trim();
}

/**
 * Parse the CLI's line-based output into typed memory candidates. Forgiving by
 * design: preamble/postamble is ignored, blocks missing a valid type or title
 * are dropped, and the result is capped to the per-session write budget.
 */
export function parseDistillOutput(raw: string): DistilledMemory[] {
  const trimmed = raw.trim();
  if (!trimmed || /^none$/im.test(trimmed.split(/\r?\n/)[0]?.trim() ?? "")) return [];

  const out: DistilledMemory[] = [];
  const seen = new Set<string>();
  for (const block of trimmed.split(/^\s*---\s*$/m)) {
    if (!block.trim()) continue;
    const typeRaw = fieldValue(block, "TYPE").toLowerCase();
    const type = typeRaw.split(/\s+/)[0] ?? "";
    if (!isMemoryType(type)) continue;
    const title = fieldValue(block, "TITLE")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?,;:]+$/g, "")
      .slice(0, MEMORY_TITLE_MAX)
      .trim();
    if (!title) continue;
    const key = `${type}::${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let body = fieldValue(block, "BODY").slice(0, MEMORY_BODY_MAX).trim();
    if (/^(none|n\/a|-)$/i.test(body)) body = "";
    out.push({ type, title, body });
    if (out.length >= MEMORY_AUTO_CAPTURE_PER_SESSION_MAX) break;
  }
  return out;
}

/** True when the LLM engine is enabled — callers can skip building inputs otherwise. */
export function isRecallEngineEnabled(): boolean {
  return readRecallSettings().recallEngineEnabled;
}

/**
 * Distill a finished session into typed memory candidates via the configured
 * Recall-engine harness. Returns [] when the engine is off, the session has no
 * prompt content, or the CLI fails — never throws, so a caller on a hot path
 * (session finish) can `await` it without a guard.
 */
export async function distillSession(input: DistillSessionInput): Promise<DistilledMemory[]> {
  const settings = readRecallSettings();
  if (!settings.recallEngineEnabled) return [];
  if (!input.prompts.some((p) => p.trim())) return [];
  if (inFlightDistills >= MAX_CONCURRENT_DISTILLS) return [];

  inFlightDistills++;
  try {
    const prompt = buildDistillPrompt(input);
    const invocation = buildAiPrintInvocation(
      settings.recallEngineHarness,
      prompt,
      settings.recallEngineModel,
    );
    const raw = await runCli(invocation.cmd, invocation.args, {
      cwd: os.tmpdir(),
      timeoutMs: DISTILL_TIMEOUT_MS,
    });
    return parseDistillOutput(raw);
  } catch {
    // Engine unreachable / timeout / bad output — capture nothing this session.
    return [];
  } finally {
    inFlightDistills--;
  }
}

// --- "Verify against code" pass (Phase 3 hygiene) -------------------------------
//
// Unlike distillation (which runs in a neutral tmpdir so the CLI never reads the
// repo), verification is *supposed* to read the code — that's the whole point —
// so the caller runs it in the project's own directory. It asks the engine
// whether a single stored fact still holds and, if the code contradicts it,
// returns a corrected fact the service auto-supersedes with.

const VERIFY_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT_VERIFIES = 2;
let inFlightVerifies = 0;

export interface VerifyMemoryTarget {
  type: MemoryType;
  title: string;
  body: string;
}

export interface VerifyResult {
  verdict: MemoryVerifyVerdict;
  /** Only present on `contradicted`: the corrected fact derived from the code. */
  correctedTitle?: string;
  correctedBody?: string;
}

export function buildVerifyPrompt(memory: VerifyMemoryTarget): string {
  return [
    "You are auditing one stored project-memory fact against the CURRENT code in",
    "this repository. Inspect the codebase (read files, grep) as needed, then judge",
    "whether the fact still holds.",
    "",
    "The stored fact:",
    `TYPE: ${memory.type} (${MEMORY_TYPE_LABELS[memory.type]})`,
    `TITLE: ${memory.title}`,
    `BODY: ${memory.body || "(none)"}`,
    "",
    "Decide one verdict:",
    "- verified: the fact is still accurate.",
    "- stale: you cannot confirm it from the current code (moved, removed, unclear).",
    "- contradicted: the code proves it wrong. Provide the corrected fact.",
    "",
    "Output format — emit exactly:",
    "VERDICT: <verified | stale | contradicted>",
    "TITLE: <corrected headline — only if contradicted>",
    "BODY: <corrected detail — only if contradicted, one line>",
    "Output nothing else — no preamble, no explanation, no code fences.",
  ].join("\n");
}

/**
 * Parse the verify pass output into a verdict. Forgiving: an unrecognized or
 * missing verdict falls back to `skipped` (no change applied), and a
 * `contradicted` verdict without a usable corrected title is downgraded to
 * `stale` so we never supersede with an empty fact.
 */
export function parseVerifyOutput(raw: string): VerifyResult {
  const verdictRaw = fieldValue(raw, "VERDICT").toLowerCase();
  const verdict = verdictRaw.split(/\s+/)[0] ?? "";
  if (verdict === "verified") return { verdict: "verified" };
  if (verdict === "stale") return { verdict: "stale" };
  if (verdict === "contradicted") {
    const correctedTitle = fieldValue(raw, "TITLE")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?,;:]+$/g, "")
      .slice(0, MEMORY_TITLE_MAX)
      .trim();
    if (!correctedTitle) return { verdict: "stale" };
    let correctedBody = fieldValue(raw, "BODY").slice(0, MEMORY_BODY_MAX).trim();
    if (/^(none|n\/a|-)$/i.test(correctedBody)) correctedBody = "";
    return { verdict: "contradicted", correctedTitle, correctedBody };
  }
  return { verdict: "skipped" };
}

/**
 * Run the engine's verify pass in the project's working directory. Returns a
 * `skipped` verdict — never throws — when the engine is off, we're already at
 * the concurrency cap, or the CLI fails, so the caller can apply verdicts
 * uniformly without a guard.
 */
export async function verifyMemoryAgainstCode(input: {
  memory: VerifyMemoryTarget;
  cwd: string;
}): Promise<VerifyResult> {
  const settings = readRecallSettings();
  if (!settings.recallEngineEnabled) return { verdict: "skipped" };
  if (inFlightVerifies >= MAX_CONCURRENT_VERIFIES) return { verdict: "skipped" };

  inFlightVerifies++;
  try {
    const prompt = buildVerifyPrompt(input.memory);
    const invocation = buildAiPrintInvocation(
      settings.recallEngineHarness,
      prompt,
      settings.recallEngineModel,
    );
    const raw = await runCli(invocation.cmd, invocation.args, {
      cwd: input.cwd,
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    return parseVerifyOutput(raw);
  } catch {
    return { verdict: "skipped" };
  } finally {
    inFlightVerifies--;
  }
}
