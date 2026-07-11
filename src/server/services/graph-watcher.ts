// Live code-graph watcher: while a project is in active use, watch its source
// tree and fire an incremental re-index (debounced) whenever a source file
// changes, so mid-session graph_* queries reflect the current code. Reuses the
// existing incremental indexer verbatim — the watcher only decides WHEN to run
// it. Must live server-side (in-process) to call startGraphIndex directly.
//
// Lifecycle is idle-TTL, not reference-counted: `ensureGraphWatch` is called on
// session activity (SessionStart / prompt submit) and (re)arms an idle timer, so
// the watcher stays alive through an active session and stops itself a while
// after activity ceases. This avoids the trap of pairing a once-per-session
// SessionStart against a per-turn session:finished (which would stop it mid-work).

import * as fs from "node:fs";
import * as path from "node:path";
import { GRAPH_IGNORE_DIRS, isGraphSourceFile } from "~/shared/code-graph";
import { events } from "../events";
import { findProjectById } from "../repositories/projects.repo";
import { isGraphIndexRunning, startGraphIndex } from "./code-graph-indexer";
import { readRecallSettings } from "./recall-settings";

// Trailing debounce so a burst of saves (or an editor's atomic write) collapses
// into one incremental build.
export const GRAPH_WATCH_DEBOUNCE_MS = 2500;
// Stop watching a project this long after its last session activity.
export const GRAPH_WATCH_IDLE_TTL_MS = 15 * 60 * 1000;

// Recursive fs.watch is supported on macOS + Windows only. On Linux we skip the
// watcher entirely and rely on the session-start auto-index (graph-auto-index.ts).
const RECURSIVE_WATCH_SUPPORTED = process.platform === "darwin" || process.platform === "win32";

const IGNORE_DIRS = new Set(GRAPH_IGNORE_DIRS);

interface WatchEntry {
  watcher: fs.FSWatcher;
  debounce: NodeJS.Timeout | null;
  idle: NodeJS.Timeout | null;
  // A change arrived while a build was running — re-fire once when it finishes.
  dirty: boolean;
}

const watchers = new Map<string, WatchEntry>();

/**
 * Ensure a live watcher exists for a project and keep it alive. Call on session
 * activity. Gated by the code-graph setting + local-projects-only; a no-op on
 * platforms without recursive fs.watch. Idempotent — just re-arms the idle timer
 * when a watcher already exists.
 */
export function ensureGraphWatch(projectId: string): void {
  if (!RECURSIVE_WATCH_SUPPORTED) return;
  if (!readRecallSettings().codeGraphEnabled) return;

  const existing = watchers.get(projectId);
  if (existing) {
    armIdle(projectId, existing);
    return;
  }

  const project = findProjectById(projectId);
  if (!project || project.sandboxId) return; // local projects only
  const root = path.resolve(project.path);

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, filename) => {
      if (filename) onFsEvent(projectId, filename.toString());
    });
  } catch {
    return; // path gone / watch unsupported — skip silently
  }

  const entry: WatchEntry = { watcher, debounce: null, idle: null, dirty: false };
  watchers.set(projectId, entry);
  armIdle(projectId, entry);
}

function onFsEvent(projectId: string, filename: string): void {
  if (shouldIgnore(filename)) return;
  const entry = watchers.get(projectId);
  if (!entry) return;
  if (entry.debounce) clearTimeout(entry.debounce);
  entry.debounce = setTimeout(() => {
    entry.debounce = null;
    fireIncremental(projectId);
  }, GRAPH_WATCH_DEBOUNCE_MS);
  entry.debounce.unref?.();
}

// Decide whether a changed path is worth a re-index: skip ignored dirs, dotfiles,
// and non-source files. Recursive fs.watch still delivers node_modules events, so
// this filter is what prevents an install-time storm.
function shouldIgnore(filename: string): boolean {
  const segments = filename.split(/[\\/]/).filter(Boolean);
  if (segments.some((s) => IGNORE_DIRS.has(s))) return true;
  // Any dot-segment along the path (not just the basename) is non-source —
  // .worktree/<branch>/src/foo.ts must not re-index the parent project.
  if (segments.length === 0 || segments.some((s) => s.startsWith("."))) return true;
  return !isGraphSourceFile(filename);
}

function fireIncremental(projectId: string): void {
  const entry = watchers.get(projectId);
  if (!entry) return;
  if (isGraphIndexRunning(projectId)) {
    entry.dirty = true; // coalesce: re-fire when the in-flight build finishes
    return;
  }
  try {
    startGraphIndex(projectId, "incremental");
  } catch {
    // Project path gone / became sandboxed — stop watching to avoid a hot loop.
    stopGraphWatch(projectId);
  }
}

function armIdle(projectId: string, entry: WatchEntry): void {
  if (entry.idle) clearTimeout(entry.idle);
  entry.idle = setTimeout(() => stopGraphWatch(projectId), GRAPH_WATCH_IDLE_TTL_MS);
  entry.idle.unref?.();
}

export function stopGraphWatch(projectId: string): void {
  const entry = watchers.get(projectId);
  if (!entry) return;
  if (entry.debounce) clearTimeout(entry.debounce);
  if (entry.idle) clearTimeout(entry.idle);
  try {
    entry.watcher.close();
  } catch {
    // already closed
  }
  watchers.delete(projectId);
}

export function disposeAllGraphWatchers(): void {
  for (const id of [...watchers.keys()]) stopGraphWatch(id);
}

let registered = false;

/**
 * Subscribe the coalescing re-fire to graph:indexed: if a source change landed
 * while a build was running, run one more incremental once it completes so no
 * edit is silently dropped. Idempotent per process.
 */
export function registerGraphWatchCoalesce(): void {
  if (registered) return;
  registered = true;
  events.onAny((event) => {
    if (event.type !== "graph:indexed") return;
    const entry = watchers.get(event.projectId);
    if (entry?.dirty) {
      entry.dirty = false;
      fireIncremental(event.projectId);
    }
  });
}

/** Test-only: whether a watcher is active for a project. */
export function __isWatching(projectId: string): boolean {
  return watchers.has(projectId);
}
