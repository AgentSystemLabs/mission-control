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

/**
 * Classify a `git diff` patch body into the GitDiff union: empty, binary,
 * too-large (over the byte or line cap), or renderable text.
 */
export function classifyDiffPatch(patch: string): GitDiff {
  if (!patch.trim()) return { kind: "empty" };
  if (isBinaryPatch(patch)) return { kind: "binary" };

  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > DIFF_MAX_BYTES) {
    const lines = patch.split("\n").length;
    return { kind: "too-large", lines, bytes };
  }
  const newlineCount = (patch.match(/\n/g) || []).length;
  if (newlineCount > DIFF_MAX_LINES) {
    return { kind: "too-large", lines: newlineCount, bytes };
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
