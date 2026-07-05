// Claude Code hook payloads carry `transcript_path` — the absolute path to the
// session's JSONL log (assistant messages + tool_use/tool_result). We stash the
// latest per task as hooks report it, so the auto-distill pass — which runs off
// the separate session:finished event and never sees the hook payload — can read
// the full session, not just the user's prompts. Deliberately kept out of the
// generic updateStatus/session:finished signature to avoid threading a
// Claude-only field through shared plumbing.

// taskId -> latest known transcript path. The path is stable for a session, so
// we overwrite (not clear on read): the same session finishes many times and
// each distill should still find it. Bounded: nothing else evicts entries in
// production, so past the cap the oldest-inserted task is dropped (a task that
// old has long since had its last session:finished).
const MAX_TRACKED_TASKS = 500;
const transcriptPaths = new Map<string, string>();

export function setTranscriptPath(taskId: string, transcriptPath: string): void {
  if (!taskId || !transcriptPath) return;
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
