// Claude Code hook payloads carry `transcript_path` — the absolute path to the
// session's JSONL log (assistant messages + tool_use/tool_result). We stash the
// latest per task as hooks report it, so the auto-distill pass — which runs off
// the separate session:finished event and never sees the hook payload — can read
// the full session, not just the user's prompts. Deliberately kept out of the
// generic updateStatus/session:finished signature to avoid threading a
// Claude-only field through shared plumbing.

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// taskId -> latest known transcript path. The path is stable for a session, so
// we overwrite (not clear on read): the same session finishes many times and
// each distill should still find it. Bounded: nothing else evicts entries in
// production, so past the cap the oldest-inserted task is dropped (a task that
// old has long since had its last session:finished).
const MAX_TRACKED_TASKS = 500;
const transcriptPaths = new Map<string, string>();

// Claude Code writes its per-session JSONL logs under `~/.claude/projects/`
// (see token-usage.ts). The `transcript_path` we stash here is later read from
// disk and fed to the auto-distill LLM, whose output is stored as project
// memory (readable via `GET /api/projects/:id/memory`). Because the value
// arrives verbatim in an agent hook payload, an untrusted-but-token-holding
// caller could otherwise point it at any file (`~/.ssh/*.jsonl`, other repos'
// transcripts) and exfiltrate the content into memory. Pin it to the real
// Claude transcript base so only genuine session logs are ever read.
function claudeTranscriptBase(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function isAllowedTranscriptPath(transcriptPath: string): boolean {
  const trimmed = transcriptPath.trim();
  if (!trimmed || trimmed.includes("\0")) return false;
  const base = claudeTranscriptBase();
  const abs = path.resolve(trimmed);
  const withinLexical =
    abs === base || abs.startsWith(base + path.sep);
  if (!withinLexical) return false;
  // Symlink laundering: if the file exists, its realpath must still live under
  // the real base (a symlink `~/.claude/projects/x.jsonl -> /etc/shadow` would
  // otherwise pass the lexical check).
  try {
    if (fs.existsSync(abs)) {
      const realBase = fs.realpathSync(base);
      const realAbs = fs.realpathSync(abs);
      if (realAbs !== realBase && !realAbs.startsWith(realBase + path.sep)) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

export function setTranscriptPath(taskId: string, transcriptPath: string): void {
  if (!taskId || !transcriptPath) return;
  // Only accept paths inside the real Claude transcript directory — the value
  // is attacker-influenced (it comes straight from a hook payload) and is later
  // read from disk and distilled into project memory.
  if (!isAllowedTranscriptPath(transcriptPath)) return;
  // Re-insert so the Map's insertion order doubles as recency order.
  transcriptPaths.delete(taskId);
  transcriptPaths.set(taskId, transcriptPath);
  while (transcriptPaths.size > MAX_TRACKED_TASKS) {
    const oldest = transcriptPaths.keys().next().value;
    if (oldest === undefined) break;
    transcriptPaths.delete(oldest);
  }
}

export function getTranscriptPath(taskId: string): string | undefined {
  return transcriptPaths.get(taskId);
}

export function clearTranscriptPath(taskId: string): void {
  transcriptPaths.delete(taskId);
}

/** Test-only: reset all stashed paths. */
export function __resetTranscriptPaths(): void {
  transcriptPaths.clear();
}

// How far back from the end of the JSONL we look for the final assistant
// message. A turn's closing message (with its tool_use blocks and text) fits
// comfortably in this window; anything longer isn't worth scanning for a pet
// remark anyway.
const TAIL_READ_BYTES = 256 * 1024;

/**
 * The text of the last assistant message in a task's session transcript, or
 * null when there is no stashed path / readable file / assistant text. Reads
 * only the file's tail, newest lines first — this runs inside the Stop hook's
 * request, so it must stay cheap and fail-soft.
 */
export function readLastAssistantText(taskId: string): string | null {
  const transcriptPath = transcriptPaths.get(taskId);
  if (!transcriptPath) return null;
  let tail: string;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const { size } = fs.fstatSync(fd);
      const start = Math.max(0, size - TAIL_READ_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      tail = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const lines = tail.split("\n");
  // The first line of a mid-file tail read is almost certainly truncated;
  // JSON.parse rejects it and we skip on — no special-casing needed.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec == null || typeof rec !== "object") continue;
    const record = rec as Record<string, unknown>;
    const message = record.message;
    const content =
      message != null && typeof message === "object"
        ? (message as Record<string, unknown>).content
        : record.content;
    // A real user prompt (string content, or a text block — tool_result echoes
    // are arrays of tool_result blocks) marks the previous turn's boundary:
    // stop rather than resurface an older response's text.
    if (record.type === "user") {
      if (typeof content === "string" && content.trim()) return null;
      if (
        Array.isArray(content) &&
        content.some(
          (b) =>
            b != null &&
            typeof b === "object" &&
            (b as Record<string, unknown>).type === "text",
        )
      ) {
        return null;
      }
      continue;
    }
    if (record.type !== "assistant") continue;
    if (typeof content === "string") {
      const trimmed = content.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const block of content) {
      if (block == null || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        texts.push(b.text.trim());
      }
    }
    // A tool_use-only record is the middle of a turn; keep walking back to
    // find the message that actually carried prose.
    if (texts.length) return texts.join("\n");
  }
  return null;
}
