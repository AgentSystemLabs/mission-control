/** Task ids whose PTY is being torn down on purpose (archive, delete, project close). */
const intentional = new Set<string>();

export function markIntentionalSessionClose(taskId: string): void {
  intentional.add(taskId);
}

/** Returns true once per marked close; used to skip auto-delete on PTY exit. */
export function consumeIntentionalSessionClose(taskId: string): boolean {
  if (!intentional.has(taskId)) return false;
  intentional.delete(taskId);
  return true;
}

/** Test helper — not used in production paths. */
export function clearIntentionalSessionCloses(): void {
  intentional.clear();
}
