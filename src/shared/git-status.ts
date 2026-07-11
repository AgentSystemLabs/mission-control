// Runtime-agnostic git status/diff result types + pure parsers, shared by the
// server git service (src/server/services/git.ts) and the remote sandbox
// agent's git RPC. Single source of truth for the wire contract the host's
// GitDiffView consumes, whether it reads from the local HTTP API or from a
// remote VM over WebSocket RPC.

export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged"
  | "type-changed";

export type GitChangedFile = {
  path: string;
  /** Old path for renames/copies. */
  origPath?: string;
  status: GitFileStatus;
};

export type GitStatus = {
  branch: string;
  staged: GitChangedFile[];
  unstaged: GitChangedFile[];
  /** Total unique files across staged + unstaged — for the header indicator. */
  changedCount: number;
  /**
   * Commits on HEAD not yet on the push target — what `git push` would publish.
   * Prefers the configured upstream; falls back to `origin/main` / `main`.
   * `null` when no comparable ref exists (e.g. fresh repo, detached HEAD).
   */
  aheadCount: number | null;
  /**
   * Commits on the configured upstream (`@{u}`) that HEAD does not have yet —
   * what a `git pull` would bring in. Strictly the branch's own tracking ref
   * (no `origin/main` fallback), so a feature branch isn't reported "behind"
   * just because main advanced. `null` when the branch has no upstream, or when
   * the producer doesn't compute it (e.g. the remote sandbox agent's git RPC).
   * Only meaningful once remote-tracking refs are fresh — the host runs a
   * periodic background fetch to keep it current.
   */
  behindCount: number | null;
};

export type GitDiff =
  | { kind: "text"; patch: string; truncated: boolean }
  | { kind: "binary" }
  | { kind: "too-large"; lines: number; bytes: number }
  | { kind: "empty" };

/** Cap diff bodies so a giant lockfile diff can't lock the renderer. */
export const DIFF_MAX_BYTES = 2 * 1024 * 1024;
export const DIFF_MAX_LINES = 50_000;

/** Bytes to scan when sniffing raw file content for NUL (binary) markers. */
export const BUFFER_BINARY_SNIFF_BYTES = 8 * 1024;

/** Cheap binary sniff: any NUL in the first {@link BUFFER_BINARY_SNIFF_BYTES}. */
export function bufferLooksBinary(buf: Uint8Array): boolean {
  const len = Math.min(buf.length, BUFFER_BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Map a porcelain v1 status code to one of our enum values. */
export function mapStatusCode(code: string): GitFileStatus {
  if (code === "?") return "untracked";
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      return "modified";
  }
}

/**
 * Parse `git status --porcelain=v1 -z`. Each entry is XY <path>\0, except
 * renames/copies which are XY <new>\0<old>\0.
 */
export function parsePorcelainZ(stdout: string): { staged: GitChangedFile[]; unstaged: GitChangedFile[] } {
  const staged: GitChangedFile[] = [];
  const unstaged: GitChangedFile[] = [];
  const parts = stdout.split("\0");
  // Trailing element after last NUL is empty.
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 3) continue;
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    let origPath: string | undefined;
    // Renamed / copied entries have a paired "from" path immediately after.
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      origPath = parts[i + 1];
      i++;
    }
    if (x === "?" && y === "?") {
      unstaged.push({ path, status: "untracked" });
      continue;
    }
    if (x !== " " && x !== "?") {
      staged.push({ path, origPath, status: mapStatusCode(x) });
    }
    if (y !== " " && y !== "?") {
      unstaged.push({ path, status: mapStatusCode(y) });
    }
  }
  return { staged, unstaged };
}

export type GitBranchHeader = {
  /** Short branch name, or "HEAD" when detached. */
  branch: string;
  /** True when the branch has a configured upstream (a `...<remote>` in the header). */
  hasUpstream: boolean;
  /**
   * Commits ahead of / behind the upstream, straight from the header's
   * `[ahead N, behind M]`. Both `0` when an upstream exists but the bracket is
   * absent (in sync). `null` when there is no upstream (caller falls back).
   */
  ahead: number | null;
  behind: number | null;
};

/**
 * Parse the `## ...` branch header emitted by `git status --porcelain=v1 -b`.
 * Handles the forms git produces:
 *   `## main`                              (no upstream)
 *   `## main...origin/main`                (upstream, in sync)
 *   `## main...origin/main [ahead 2]`      (ahead only)
 *   `## main...origin/main [behind 1]`     (behind only)
 *   `## main...origin/main [ahead 1, behind 1]` (diverged)
 *   `## HEAD (no branch)`                  (detached)
 *   `## No commits yet on main`            (unborn branch)
 */
export function parseGitBranchHeader(headerLine: string): GitBranchHeader {
  let s = headerLine.replace(/^##\s?/, "").trim();

  // Peel off the trailing `[ahead N, behind M]` bracket, if any.
  let ahead: number | null = null;
  let behind: number | null = null;
  const bracket = s.match(/\s*\[([^\]]*)\]\s*$/);
  if (bracket) {
    s = s.slice(0, bracket.index).trimEnd();
    const am = bracket[1].match(/ahead (\d+)/);
    const bm = bracket[1].match(/behind (\d+)/);
    if (am) ahead = parseInt(am[1], 10);
    if (bm) behind = parseInt(bm[1], 10);
  }

  // Detached HEAD — no branch, no upstream.
  if (/^HEAD \(/.test(s)) {
    return { branch: "HEAD", hasUpstream: false, ahead: null, behind: null };
  }

  // Unborn branch: the name trails the phrase git prints before any commit.
  const unborn = s.match(/^(?:No commits yet on|Initial commit on) (.+)$/);
  if (unborn) s = unborn[1].trim();

  // `<branch>...<upstream>` — the `...` marks a configured upstream.
  const sep = s.indexOf("...");
  const hasUpstream = sep >= 0;
  const branch = (hasUpstream ? s.slice(0, sep) : s).trim() || "HEAD";
  return {
    branch,
    hasUpstream,
    ahead: hasUpstream ? ahead ?? 0 : null,
    behind: hasUpstream ? behind ?? 0 : null,
  };
}

/** Compute the unique changed-file count across staged + unstaged. */
export function changedFileCount(staged: GitChangedFile[], unstaged: GitChangedFile[]): number {
  const seen = new Set<string>();
  for (const f of staged) seen.add(f.path);
  for (const f of unstaged) seen.add(f.path);
  return seen.size;
}

/** Detect a binary patch by looking at the textual diff git emits. */
export function isBinaryPatch(patch: string): boolean {
  return /^Binary files .* and .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch);
}

/** Count newline characters — used consistently for line-cap checks and metadata. */
function patchLineCount(patch: string): number {
  return (patch.match(/\n/g) || []).length;
}

/**
 * Classify a `git diff` patch body into the GitDiff union: empty, binary,
 * too-large (over the byte or line cap), or renderable text.
 */
export function classifyDiffPatch(patch: string): GitDiff {
  if (!patch.trim()) return { kind: "empty" };
  if (isBinaryPatch(patch)) return { kind: "binary" };

  const bytes = Buffer.byteLength(patch, "utf8");
  const lines = patchLineCount(patch);
  if (bytes > DIFF_MAX_BYTES) {
    return { kind: "too-large", lines, bytes };
  }
  if (lines > DIFF_MAX_LINES) {
    return { kind: "too-large", lines, bytes };
  }
  return { kind: "text", patch, truncated: false };
}

/** Build a unified-diff-style patch for an untracked file (all lines as additions). */
export function buildAdditionsDiff(file: string, content: string): string {
  const lines = content.split("\n");
  const header =
    `diff --git a/${file} b/${file}\n` +
    `new file\n` +
    `--- /dev/null\n` +
    `+++ b/${file}\n` +
    `@@ -0,0 +1,${lines.length} @@\n`;
  const body = lines.map((l) => `+${l}`).join("\n");
  return header + body;
}
