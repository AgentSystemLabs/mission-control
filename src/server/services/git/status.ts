import { gitOk, projectCwd, runGit } from "./exec";

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

/** Map a porcelain v1 status code to one of our enum values. */
function mapStatusCode(code: string): GitFileStatus {
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

export async function getGitStatus(projectId: string): Promise<GitStatus> {
  const cwd = projectCwd(projectId);
  const [statusOut, branchOut, aheadCount] = await Promise.all([
    gitOk(cwd, ["status", "--porcelain=v1", "-uall", "-z"]),
    gitOk(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD\n"),
    countAhead(cwd),
  ]);
  const { staged, unstaged } = parsePorcelainZ(statusOut);
  const seen = new Set<string>();
  for (const f of staged) seen.add(f.path);
  for (const f of unstaged) seen.add(f.path);
  return {
    branch: branchOut.trim() || "HEAD",
    staged,
    unstaged,
    changedCount: seen.size,
    aheadCount,
  };
}

async function countAhead(cwd: string): Promise<number | null> {
  for (const target of ["@{u}", "origin/main", "main"]) {
    const r = await runGit(cwd, ["rev-list", "--count", `${target}..HEAD`]);
    if (r.code === 0) {
      const n = parseInt(r.stdout.trim(), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
