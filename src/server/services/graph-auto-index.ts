// Auto-index the code graph when a session starts, so mid-session graph_*
// queries and the NEXT session's brief reflect current code without anyone
// clicking Build/Rebuild. Reuses the existing incremental indexer verbatim; the
// heavy lifting (enumerate/parse/commit) already runs in the background off the
// caller. A per-project cooldown collapses the SessionStart bursts (startup,
// resume, and clear all fire it). Fail-soft and non-blocking — this runs on the
// hook HTTP path, never on the PTY spawn path, so it can't delay a session.

import { findProjectById } from "../repositories/projects.repo";
import { getGraphStatus } from "./code-graph";
import { isGraphIndexRunning, startGraphIndex } from "./code-graph-indexer";
import { readRecallSettings } from "./recall-settings";

// SessionStart can fire several times in quick succession (open, resume, /clear).
// Collapse those to at most one auto-index per project per window.
const AUTO_INDEX_COOLDOWN_MS = 5 * 60 * 1000;
const lastAutoIndexAt = new Map<string, number>();

/**
 * Kick a background graph (re)index for a project if it's due. Gated by the
 * code-graph setting, local-projects-only (matches the indexer), skipped while a
 * build is already running or inside the cooldown. Never throws.
 */
export function maybeAutoIndexGraph(projectId: string): void {
  if (!readRecallSettings().codeGraphEnabled) return;

  const project = findProjectById(projectId);
  // Local projects only: a sandboxed project's source lives in its container,
  // which the host-side indexer can't read.
  if (!project || project.sandboxId) return;

  if (isGraphIndexRunning(projectId)) return;

  const now = nowMs();
  const last = lastAutoIndexAt.get(projectId);
  if (last !== undefined && now - last < AUTO_INDEX_COOLDOWN_MS) return;
  lastAutoIndexAt.set(projectId, now);

  // Never re-index from scratch once we have a graph — incremental re-hashes all
  // files but only parses the ones that changed, so it's cheap on a warm repo.
  const mode = getGraphStatus(projectId).indexed ? "incremental" : "full";
  try {
    startGraphIndex(projectId, mode);
  } catch {
    // GraphIndexError (missing path, etc.) or anything else must not fault the
    // hook. Drop the cooldown stamp so a later, valid start can still retry.
    lastAutoIndexAt.delete(projectId);
  }
}

// Wrapped so tests can control time without stubbing globally.
function nowMs(): number {
  return Date.now();
}

/** Test-only: clear the per-project cooldown so successive triggers aren't skipped. */
export function __resetAutoIndexCooldown(): void {
  lastAutoIndexAt.clear();
}
