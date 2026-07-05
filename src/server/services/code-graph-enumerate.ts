// Decide *what* to parse — never a naive fs walk of everything. Prefer git
// (`git ls-files` + untracked-but-not-ignored) so .gitignore and node_modules
// are excluded for free; fall back to a hard-skip-list fs walk for non-git
// projects. Minified/oversized files are skipped with a recorded reason, and the
// total is capped with a logged warning (no silent truncation).

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  GRAPH_IGNORE_DIRS,
  GRAPH_MAX_FILES,
  GRAPH_MAX_FILE_BYTES,
  isGraphSourceFile,
  type GraphSkippedFile,
} from "~/shared/code-graph";

export interface EnumerationResult {
  /** Repo-relative source-file paths (POSIX separators), sorted, capped. */
  files: string[];
  skipped: GraphSkippedFile[];
  /** True if the file list was truncated at GRAPH_MAX_FILES. */
  cappedAtLimit: boolean;
  usedGit: boolean;
}

const GIT_TIMEOUT_MS = 30_000;

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

function fsWalk(root: string): string[] {
  const out: string[] = [];
  const ignore = new Set(GRAPH_IGNORE_DIRS);
  const stack: string[] = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
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
  const all = (tracked ?? fsWalk(root)).map((p) => p.split(path.sep).join("/"));

  const skipped: GraphSkippedFile[] = [];
  const candidates: string[] = [];
  for (const rel of all) {
    if (!isGraphSourceFile(rel)) continue;
    if (isMinified(rel)) {
      skipped.push({ path: rel, reason: "minified" });
      continue;
    }
    let size = 0;
    try {
      size = fs.statSync(path.join(root, rel)).size;
    } catch {
      skipped.push({ path: rel, reason: "unreadable" });
      continue;
    }
    if (size > GRAPH_MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "too-large" });
      continue;
    }
    candidates.push(rel);
  }

  candidates.sort();
  let cappedAtLimit = false;
  let files = candidates;
  if (candidates.length > GRAPH_MAX_FILES) {
    cappedAtLimit = true;
    files = candidates.slice(0, GRAPH_MAX_FILES);
    for (const rel of candidates.slice(GRAPH_MAX_FILES)) {
      skipped.push({ path: rel, reason: "over-cap" });
    }
  }

  return { files, skipped, cappedAtLimit, usedGit };
}
