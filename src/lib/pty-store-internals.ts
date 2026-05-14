/**
 * Shared machinery for the renderer's PTY-backed stores.
 *
 * Both `terminal-store` (task-driven) and `user-terminal-store` (user-created
 * shells) share a small kernel of behavior:
 *   - persist a project-keyed JSON record in localStorage with a SSR-safe
 *     load + best-effort write,
 *   - kill an Electron PTY by id, swallowing failure,
 *   - mutate the project-keyed record on `task:deleted` / `user-terminal:deleted`
 *     / `project:deleted` SSE events.
 *
 * The two stores have different value shapes around the kernel (sessions vs.
 * per-project session buckets; api-backed CRUD vs. in-memory only), so they
 * still own their state and reducers — this file just hosts the genuinely
 * common pieces so they don't drift.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getRuntime } from "./runtime";

/** Best-effort kill of a PTY id. No-ops when no runtime is available or id is null. */
export async function killPty(ptyId: string | null): Promise<void> {
  if (!ptyId) return;
  const electron = getRuntime();
  if (!electron) return;
  await electron.pty.kill(ptyId).catch(() => undefined);
}

/**
 * useState backed by a single localStorage key holding a JSON record.
 * SSR-safe (initial value `{}` server-side) and tolerant of parse/quota errors.
 */
export function useLocalStorageRecord<T>(
  storageKey: string,
  logTag: string
): [Record<string, T>, Dispatch<SetStateAction<Record<string, T>>>] {
  const [state, setState] = useState<Record<string, T>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Record<string, T>) : {};
    } catch (err) {
      console.warn(`[${logTag}] read ${storageKey} failed:`, err);
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (err) {
      console.warn(`[${logTag}] persist ${storageKey} failed:`, err);
    }
  }, [state, storageKey, logTag]);
  return [state, setState];
}

/**
 * Return a new record with `targetKey` removed, or the original record
 * unchanged when the key isn't present. Stable identity on no-op makes this
 * safe to call inside setState updaters.
 */
export function removeKey<T>(
  record: Record<string, T>,
  targetKey: string
): Record<string, T> {
  if (!(targetKey in record)) return record;
  const next = { ...record };
  delete next[targetKey];
  return next;
}

/**
 * Walk a record and replace every entry whose value === `targetValue` with
 * `replacement`. Returns the original record unchanged when no entry matched.
 */
export function nullifyMatchingValues<T>(
  record: Record<string, T>,
  targetValue: T,
  replacement: T
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === targetValue) {
      next[k] = replacement;
      changed = true;
    } else {
      next[k] = v;
    }
  }
  return changed ? next : record;
}
