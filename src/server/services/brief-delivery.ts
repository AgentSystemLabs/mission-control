// In-memory record of when each task's Session Brief was last served for
// spawn-time injection (electron fetches /api/tasks/:id/brief with record=true
// right before the PTY spawns and writes it into the agent's auto-load file).
// The SessionStart hook consults this to decide whether to inject a fallback
// brief: no recent serve means the spawn-time fetch never reached us — the
// exact failure `recall.brief.fetch_failed` logs — so the hook response is the
// only channel left. Held in memory on purpose: the server lives inside the
// app, and the app's PTY sessions die with it, so this state's lifetime matches
// the sessions it describes.

const deliveredAt = new Map<string, number>();
const DELIVERED_CAP = 5000;

/** Record that a spawn-time brief was just served for this task. */
export function markBriefDelivered(taskId: string): void {
  // Bound growth on long-lived servers; dropping everything just re-injects a
  // (deduplicated) fallback brief once for currently-active sessions — harmless.
  if (deliveredAt.size >= DELIVERED_CAP && !deliveredAt.has(taskId)) deliveredAt.clear();
  deliveredAt.set(taskId, Date.now());
}

/** When this task's brief was last served for spawn-time injection, if ever. */
export function briefDeliveredAt(taskId: string): number | undefined {
  return deliveredAt.get(taskId);
}

/** Test hook: forget all recorded deliveries. */
export function resetBriefDeliveries(): void {
  deliveredAt.clear();
}
