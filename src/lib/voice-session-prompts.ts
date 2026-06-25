// Consume-once registry of starting prompts for voice-created sessions, keyed by
// taskId. createSession stashes the spoken task here; TerminalPane reads it at
// the first (non-resume) spawn and passes it as the PTY's initialInput, then it's
// gone — so reloads and re-spawns of the same session never re-inject the prompt.
// Keeping it out-of-band means the normal session path is completely unaffected.

const pending = new Map<string, string>();
// Defense-in-depth bound: a session that's created but never spawns (e.g. a
// failed create) would otherwise strand its entry forever. Evict oldest first.
const MAX_PENDING = 16;

export function setPendingInitialInput(taskId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(taskId, trimmed);
}

export function takePendingInitialInput(taskId: string): string | undefined {
  const text = pending.get(taskId);
  if (text !== undefined) pending.delete(taskId);
  return text;
}
