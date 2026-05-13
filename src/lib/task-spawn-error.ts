// Per-task spawn-error store. Lives outside the terminal-store on purpose:
// TerminalPane writes the error from inside an async useEffect when a PTY
// spawn rejects, TaskCard reads it for a card-level "spawn failed / retry"
// affordance, and the user-terminal pane reuses it for its own tasks. Keeping
// it module-local means a collapsed pane never hides a spawn failure: the
// state is reactive to TaskCard whether or not the pane is mounted.

import { useSyncExternalStore } from "react";

export type TaskSpawnError = {
  message: string;
  // Monotonic id to let mounted panes know they should re-attempt spawn when
  // bumped by the user via the TaskCard "Retry" button.
  retryNonce: number;
  // We only want the first occurrence of a given error to surface a toast —
  // subsequent re-renders, retries, or remounts must not re-toast.
  toasted: boolean;
};

type Listener = () => void;

const errors = new Map<string, TaskSpawnError>();
const listeners = new Set<Listener>();
const retryListeners = new Map<string, Set<() => void>>();

function emit() {
  for (const l of listeners) l();
}

export function getTaskSpawnError(taskId: string): TaskSpawnError | undefined {
  return errors.get(taskId);
}

/**
 * Returns whether the toast was actually shown (true on first occurrence
 * only). The caller toasts; we just track de-dup.
 */
export function recordTaskSpawnError(taskId: string, message: string): boolean {
  const prev = errors.get(taskId);
  const next: TaskSpawnError = {
    message,
    retryNonce: prev?.retryNonce ?? 0,
    toasted: prev?.toasted ?? false,
  };
  const firstOccurrence = !next.toasted;
  next.toasted = true;
  errors.set(taskId, next);
  emit();
  return firstOccurrence;
}

export function clearTaskSpawnError(taskId: string): void {
  if (!errors.has(taskId)) return;
  errors.delete(taskId);
  emit();
}

export function requestTaskSpawnRetry(taskId: string): void {
  const prev = errors.get(taskId);
  if (prev) {
    errors.set(taskId, { ...prev, retryNonce: prev.retryNonce + 1 });
    emit();
  }
  const set = retryListeners.get(taskId);
  if (set) for (const fn of set) fn();
}

export function subscribeTaskSpawnRetry(taskId: string, fn: () => void): () => void {
  let set = retryListeners.get(taskId);
  if (!set) {
    set = new Set();
    retryListeners.set(taskId, set);
  }
  set.add(fn);
  return () => {
    const s = retryListeners.get(taskId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) retryListeners.delete(taskId);
  };
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useTaskSpawnError(taskId: string): TaskSpawnError | undefined {
  return useSyncExternalStore(
    subscribe,
    () => errors.get(taskId),
    () => undefined
  );
}
