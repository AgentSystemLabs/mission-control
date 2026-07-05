// Claude Code hook payloads carry `transcript_path` — the absolute path to the
// session's JSONL log (assistant messages + tool_use/tool_result). We stash the
// latest per task as hooks report it, so the auto-distill pass — which runs off
// the separate session:finished event and never sees the hook payload — can read
// the full session, not just the user's prompts. Deliberately kept out of the
// generic updateStatus/session:finished signature to avoid threading a
// Claude-only field through shared plumbing.

// taskId -> latest known transcript path. The path is stable for a session, so
// we overwrite (not clear on read): the same session finishes many times and
// each distill should still find it.
const transcriptPaths = new Map<string, string>();

export function setTranscriptPath(taskId: string, transcriptPath: string): void {
  if (!taskId || !transcriptPath) return;
  transcriptPaths.set(taskId, transcriptPath);
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
