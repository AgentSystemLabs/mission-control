// Decide *what* to parse — never a naive fs walk of everything. Prefer git
// (`git ls-files` + untracked-but-not-ignored) so .gitignore and node_modules
// are excluded for free; fall back to a hard-skip-list fs walk for non-git
// projects. Minified/oversized files are skipped with a recorded reason, and the
// total is capped with a logged warning (no silent truncation).
//
// Fully async: the walk and the per-file stats go through fs.promises in small
// concurrent batches, so enumerating a big repo never blocks the server's event
// loop the way the old statSync/readdirSync pass did. Each file's stat (size +
// mtime) rides along in the result so the indexer can gate reads on it instead
// of re-hashing everything.

import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Dirent } from "node:fs";
import {
  GRAPH_IGNORE_DIRS,
  GRAPH_MAX_FILES,
  GRAPH_MAX_FILE_BYTES,
  isGraphSourceFile,
  type GraphSkippedFile,
} from "~/shared/code-graph";

export interface EnumeratedFile {
  /** Repo-relative path (POSIX separators). */
  path: string;
  size: number;
  mtimeMs: number;
}

export interface EnumerationResult {
  /** Source files with their stat info, sorted by path, capped. */
  files: EnumeratedFile[];
  skipped: GraphSkippedFile[];
  /** True if the file list was truncated at GRAPH_MAX_FILES. */
  cappedAtLimit: boolean;
  usedGit: boolean;
}

const GIT_TIMEOUT_MS = 30_000;
/** Concurrent fs.stat calls per batch — enough to hide latency, small enough
 * to leave the loop responsive between batches. */
const STAT_BATCH = 32;

function runGit(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout);
      },
    );
  });
}

async function gitTracked(root: string): Promise<string[] | null> {
  const [tracked, untracked] = await Promise.all([
    runGit(root, ["ls-files", "-z"]),
    runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (tracked === null) return null; // not a git repo (or git missing)
  const set = new Set<string>();
  for (const chunk of [tracked, untracked ?? ""]) {
    for (const p of chunk.split("\0")) {
      const rel = p.trim();
      if (rel) set.add(rel);
    }
  }
  return [...set];
}

async function fsWalk(root: string): Promise<string[]> {
  const out: string[] = [];
  const ignore = new Set(GRAPH_IGNORE_DIRS);
  const stack: string[] = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory() && entry.name !== ".") {
        // Skip dotdirs (.git, .next, .cache handled here too) — but keep dotfiles.
        if (ignore.has(entry.name) || entry.name === ".git") continue;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        stack.push(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

function isMinified(rel: string): boolean {
  return /\.min\.(js|jsx|ts|tsx)$/i.test(rel) || /\.(bundle|chunk)\.js$/i.test(rel);
}

export async function enumerateSourceFiles(root: string): Promise<EnumerationResult> {
  const tracked = await gitTracked(root);
  const usedGit = tracked !== null;
  const all = (tracked ?? (await fsWalk(root))).map((p) => p.split(path.sep).join("/"));

  const skipped: GraphSkippedFile[] = [];
  const sourceRels = all.filter((rel) => {
    if (!isGraphSourceFile(rel)) return false;
    if (isMinified(rel)) {
      skipped.push({ path: rel, reason: "minified" });
      return false;
    }
    return true;
  });

  const candidates: EnumeratedFile[] = [];
  for (let i = 0; i < sourceRels.length; i += STAT_BATCH) {
    const batch = sourceRels.slice(i, i + STAT_BATCH);
    const stats = await Promise.all(
      batch.map((rel) => fsp.stat(path.join(root, rel)).catch(() => null)),
    );
    for (let j = 0; j < batch.length; j++) {
      const rel = batch[j];
      const st = stats[j];
      if (!st || !st.isFile()) {
        skipped.push({ path: rel, reason: "unreadable" });
        continue;
      }
      if (st.size > GRAPH_MAX_FILE_BYTES) {
        skipped.push({ path: rel, reason: "too-large" });
        continue;
      }
      candidates.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
    }
  }

  candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let cappedAtLimit = false;
  let files = candidates;
  if (candidates.length > GRAPH_MAX_FILES) {
    cappedAtLimit = true;
    files = candidates.slice(0, GRAPH_MAX_FILES);
    for (const f of candidates.slice(GRAPH_MAX_FILES)) {
      skipped.push({ path: f.path, reason: "over-cap" });
    }
  }

  return { files, skipped, cappedAtLimit, usedGit };
}
