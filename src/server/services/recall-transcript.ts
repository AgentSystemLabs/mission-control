// Parse a Claude Code session transcript (JSONL) into a compact, tail-biased
// text blob for the distill pass. Each line is a JSON record; we pull the user's
// text, the assistant's text, and condensed tool_use/tool_result so distilled
// memories can reflect what the agent actually DID (edits, commands, results),
// not just what the user asked. Forgiving and fail-soft: an unreadable, empty,
// oversized, or garbled transcript yields null and the caller falls back to the
// prompts-only distill it did before.

import * as fs from "node:fs";

// Never read a runaway transcript fully into memory. Beyond this we slice the
// tail bytes — the latest activity is what best represents session outcomes.
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024; // 4 MB

// Per-line clamps so one giant message/tool payload can't dominate the budget.
const MESSAGE_TEXT_MAX = 800;
const TOOL_INPUT_MAX = 200;
const TOOL_RESULT_MAX = 300;

export interface ReadTranscriptOptions {
  /** Cap on the returned text; the tail (latest activity) is kept. */
  charBudget: number;
}

export function readTranscriptForDistill(
  transcriptPath: string,
  options: ReadTranscriptOptions,
): string | null {
  const raw = readTail(transcriptPath);
  if (raw == null) return null;

  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(t);
    } catch {
      continue; // partial or non-JSON line — skip
    }
    const rendered = renderRecord(rec);
    if (rendered) parts.push(rendered);
  }

  if (!parts.length) return null;
  const joined = parts.join("\n");
  const text =
    joined.length <= options.charBudget
      ? joined
      : "…\n" + joined.slice(joined.length - options.charBudget);
  return text.trim() || null;
}

/** Read the whole file, or just the tail bytes when it's very large. Null on error. */
function readTail(transcriptPath: string): string | null {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile() || stat.size === 0) return null;
    if (stat.size <= MAX_TRANSCRIPT_BYTES) {
      return fs.readFileSync(transcriptPath, "utf8");
    }
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
      const bytesRead = fs.readSync(
        fd,
        buf,
        0,
        MAX_TRANSCRIPT_BYTES,
        stat.size - MAX_TRANSCRIPT_BYTES,
      );
      const tail = buf.subarray(0, bytesRead).toString("utf8");
      // Drop the (probably partial) first line after a mid-file slice.
      const nl = tail.indexOf("\n");
      return nl >= 0 ? tail.slice(nl + 1) : tail;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function renderRecord(rec: unknown): string | null {
  if (!isObj(rec)) return null;
  const type = str(rec.type);
  const message = isObj(rec.message) ? rec.message : undefined;
  const content = message ? message.content : rec.content;

  if (type === "user") {
    // Either a real prompt (string / text block) or a tool_result echo (array).
    if (typeof content === "string") {
      const c = content.trim();
      return c ? `USER: ${clip(c, MESSAGE_TEXT_MAX)}` : null;
    }
    if (Array.isArray(content)) {
      const out: string[] = [];
      for (const block of content) {
        if (!isObj(block)) continue;
        const bt = str(block.type);
        if (bt === "text" && str(block.text).trim()) {
          out.push(`USER: ${clip(str(block.text).trim(), MESSAGE_TEXT_MAX)}`);
        } else if (bt === "tool_result") {
          const summary = summarizeToolResult(block.content);
          if (summary) out.push(`RESULT: ${clip(summary, TOOL_RESULT_MAX)}`);
        }
      }
      return out.length ? out.join("\n") : null;
    }
    return null;
  }

  if (type === "assistant") {
    if (Array.isArray(content)) {
      const out: string[] = [];
      for (const block of content) {
        if (!isObj(block)) continue;
        const bt = str(block.type);
        if (bt === "text" && str(block.text).trim()) {
          out.push(`ASSISTANT: ${clip(str(block.text).trim(), MESSAGE_TEXT_MAX)}`);
        } else if (bt === "tool_use") {
          const name = str(block.name) || "tool";
          out.push(`TOOL(${name}): ${clip(summarizeInput(block.input), TOOL_INPUT_MAX)}`);
        }
      }
      return out.length ? out.join("\n") : null;
    }
    if (typeof content === "string" && content.trim()) {
      return `ASSISTANT: ${clip(content.trim(), MESSAGE_TEXT_MAX)}`;
    }
    return null;
  }

  // summary / system / meta lines carry nothing durable — skip.
  return null;
}

function summarizeInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (isObj(input)) {
    // Prefer the fields that say what the tool touched.
    const named = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.query;
    if (typeof named === "string" && named.trim()) return named.trim();
    try {
      return JSON.stringify(input);
    } catch {
      return "";
    }
  }
  return String(input);
}

function summarizeToolResult(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (isObj(block) && str(block.type) === "text" && str(block.text).trim()) {
        texts.push(str(block.text).trim());
      } else if (typeof block === "string" && block.trim()) {
        texts.push(block.trim());
      }
    }
    return texts.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function clip(value: string, max: number): string {
  const v = value.replace(/\s+/g, " ").trim();
  return v.length <= max ? v : v.slice(0, max) + "…";
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
