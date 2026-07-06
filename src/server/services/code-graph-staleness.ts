// Per-file staleness detection for the code graph: compare a file's on-disk
// (size, mtime) against the graph_files row written at index time, so query
// results can carry an explicit "this file changed since indexing" signal
// instead of silently serving shifted line numbers. Same fastpath tradeoff as
// the indexer's stat gate: a same-size same-mtime rewrite is invisible.
//
// Two granularities: `staleFilesAmong` stats just the files in one query
// response (a handful — always fresh), `countStaleFiles` sweeps the whole
// index for the status panel (TTL-cached so polling stays cheap).

import * as fs from "node:fs";
import * as path from "node:path";
import { readGraphFileStats, type GraphFileStat } from "../repositories/code-graph.repo";
import { findProjectById } from "../repositories/projects.repo";

/**
 * The on-disk root the graph's files live under, or null when there isn't one
 * (project gone, sandboxed — files live remotely — or path missing on disk).
 */
export function resolveGraphDiskRoot(projectId: string): string | null {
  const project = findProjectById(projectId);
  if (!project || project.sandboxId) return null;
  const root = path.resolve(project.path);
  return fs.existsSync(root) ? root : null;
}

function isStale(root: string, rel: string, stored: GraphFileStat): boolean {
  try {
    const st = fs.statSync(path.join(root, rel));
    return !st.isFile() || st.size !== stored.size || st.mtimeMs !== stored.mtimeMs;
  } catch {
    return true; // deleted or moved since the index
  }
}

/**
 * Which of `filePaths` changed on disk since the last index. Deduped, input
 * order preserved. Paths without a graph_files row are skipped (legacy index
 * predating per-file stats) — no row means no baseline to compare against.
 */
export function staleFilesAmong(projectId: string, filePaths: Iterable<string>): string[] {
  const unique = [...new Set(filePaths)];
  if (!unique.length) return [];
  const root = resolveGraphDiskRoot(projectId);
  if (!root) return [];
  const stored = readGraphFileStats(projectId);
  if (!stored.size) return [];
  const out: string[] = [];
  for (const rel of unique) {
    const row = stored.get(rel);
    if (row && isStale(root, rel, row)) out.push(rel);
  }
  return out;
}

interface CountCacheEntry {
  at: number;
  lastIndexedAt: number | null;
  count: number;
}

const countCache = new Map<string, CountCacheEntry>();
const COUNT_TTL_MS = 10_000;

/**
 * How many indexed files changed on disk since the last index — the whole-graph
 * sweep behind GraphStatus.staleFileCount. TTL-cached per project (and keyed on
 * lastIndexedAt, so a finished build refreshes immediately) because the panel
 * polls status.
 */
export function countStaleFiles(projectId: string, lastIndexedAt: number | null): number {
  const now = Date.now();
  const cached = countCache.get(projectId);
  if (cached && cached.lastIndexedAt === lastIndexedAt && now - cached.at < COUNT_TTL_MS) {
    return cached.count;
  }
  let count = 0;
  const root = resolveGraphDiskRoot(projectId);
  if (root) {
    for (const [rel, row] of readGraphFileStats(projectId)) {
      if (isStale(root, rel, row)) count += 1;
    }
  }
  countCache.set(projectId, { at: now, lastIndexedAt, count });
  return count;
}

/** Test-only: drop the TTL cache so a sweep re-runs. */
export function __resetStaleCountCache(): void {
  countCache.clear();
}
