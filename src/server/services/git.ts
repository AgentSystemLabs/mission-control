import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProject } from "./projects";
import { runCli } from "./claude-cli";

const GIT_TIMEOUT_MS = 15_000;
const PUSH_TIMEOUT_MS = 30_000;
const COMMIT_MESSAGE_TIMEOUT_MS = 60_000;
/** Cap diff bodies so a giant lockfile diff can't lock the renderer. */
const DIFF_MAX_BYTES = 2 * 1024 * 1024;
const DIFF_MAX_LINES = 50_000;
/** Cap staged-diff payload sent to the AI commit message generator. */
const COMMIT_MESSAGE_DIFF_BUDGET = 200_000;

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
};

export type GitDiff =
  | { kind: "text"; patch: string; truncated: boolean }
  | { kind: "binary" }
  | { kind: "too-large"; lines: number; bytes: number }
  | { kind: "empty" };

class GitError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "GitError";
  }
}

function projectCwd(projectId: string): string {
  const p = getProject(projectId);
  if (!p) throw new GitError("project not found");
  if (!p.path || !fs.existsSync(p.path)) {
    throw new GitError("project path does not exist on disk");
  }
  return p.path;
}

type RunGitResult = { stdout: string; stderr: string; code: number };

function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; encoding?: "utf8" | "buffer" } = {},
): Promise<RunGitResult> {
  const { timeoutMs = GIT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new GitError(`git ${args[0]} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        code: code ?? 1,
      });
    });
  });
}

async function gitOk(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await runGit(cwd, args, { timeoutMs });
  if (r.code !== 0) {
    throw new GitError(`git ${args[0]} failed`, r.stderr.trim() || `exit ${r.code}`);
  }
  return r.stdout;
}

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
  const [statusOut, branchOut] = await Promise.all([
    gitOk(cwd, ["status", "--porcelain=v1", "-z"]),
    gitOk(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD\n"),
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
  };
}

/** Detect a binary patch by looking at the textual diff git emits. */
function isBinaryPatch(patch: string): boolean {
  return /^Binary files .* and .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch);
}

export async function getGitDiff(
  projectId: string,
  file: string,
  staged: boolean,
): Promise<GitDiff> {
  const cwd = projectCwd(projectId);

  // Untracked files have no index entry — `git diff` emits nothing. Synthesize
  // a unified-diff-style payload so the UI can render +lines for new files.
  if (!staged) {
    const statusOut = await gitOk(cwd, ["status", "--porcelain=v1", "-z", "--", file]);
    if (statusOut.startsWith("??")) {
      return readUntrackedAsDiff(cwd, file);
    }
  }

  const args = staged
    ? ["diff", "--cached", "--", file]
    : ["diff", "--", file];
  const r = await runGit(cwd, args);
  if (r.code !== 0) {
    throw new GitError("git diff failed", r.stderr.trim() || `exit ${r.code}`);
  }
  const patch = r.stdout;
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

/** Render an untracked file as a unified-diff-style patch (all lines as additions). */
function readUntrackedAsDiff(cwd: string, file: string): GitDiff {
  try {
    const root = path.resolve(cwd);
    const abs = path.resolve(root, file);
    // Defense-in-depth: even though `git status` already gates this branch,
    // refuse to read anything outside the repo root.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new GitError("path escapes project root");
    }
    const stat = fs.statSync(abs);
    if (stat.size > DIFF_MAX_BYTES) {
      return { kind: "too-large", lines: 0, bytes: stat.size };
    }
    const buf = fs.readFileSync(abs);
    // Cheap binary sniff: any NUL in the first 8KB.
    const sniff = buf.subarray(0, Math.min(buf.length, 8192));
    for (let i = 0; i < sniff.length; i++) {
      if (sniff[i] === 0) return { kind: "binary" };
    }
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    if (lines.length > DIFF_MAX_LINES) {
      return { kind: "too-large", lines: lines.length, bytes: stat.size };
    }
    const header =
      `diff --git a/${file} b/${file}\n` +
      `new file\n` +
      `--- /dev/null\n` +
      `+++ b/${file}\n` +
      `@@ -0,0 +1,${lines.length} @@\n`;
    const body = lines.map((l) => `+${l}`).join("\n");
    return { kind: "text", patch: header + body, truncated: false };
  } catch (e: any) {
    throw new GitError("could not read untracked file", e?.message || String(e));
  }
}

export async function stageFiles(projectId: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const cwd = projectCwd(projectId);
  await gitOk(cwd, ["add", "--", ...files]);
}

export async function deleteProjectFile(
  projectId: string,
  relPath: string,
): Promise<void> {
  if (!relPath || relPath.trim() === "") {
    throw new GitError("file path is required");
  }
  const cwd = projectCwd(projectId);
  const abs = path.resolve(cwd, relPath);
  const rootWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (abs !== cwd && !abs.startsWith(rootWithSep)) {
    throw new GitError("path escapes project root");
  }
  if (abs === cwd) {
    throw new GitError("refusing to delete project root");
  }
  try {
    await fs.promises.rm(abs, { force: false });
  } catch (e: any) {
    if (e?.code === "ENOENT") return; // already gone
    if (e?.code === "EISDIR") {
      throw new GitError("path is a directory");
    }
    throw new GitError("could not delete file", e?.message || String(e));
  }
}

export async function unstageFiles(projectId: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const cwd = projectCwd(projectId);
  // `git reset HEAD --` works whether or not HEAD has any history.
  const r = await runGit(cwd, ["reset", "HEAD", "--", ...files]);
  // `git reset` exits 1 on partial when no HEAD yet; treat fatal errors only.
  if (r.code !== 0 && /fatal:/i.test(r.stderr)) {
    // Empty repo (no HEAD) — fall back to `rm --cached` to unstage.
    if (/ambiguous argument 'HEAD'/i.test(r.stderr)) {
      await gitOk(cwd, ["rm", "--cached", "--", ...files]);
      return;
    }
    throw new GitError("git reset failed", r.stderr.trim());
  }
}

export type CommitResult =
  | { kind: "committed"; sha: string; message: string }
  | { kind: "nothing-to-commit" };

export async function commit(projectId: string): Promise<CommitResult> {
  const cwd = projectCwd(projectId);
  // Detect anything that could become a commit (staged or unstaged tracked
  // changes, or untracked files). If nothing, bail before invoking the LLM.
  const status = await gitOk(cwd, ["status", "--porcelain=v1", "-z"]);
  if (!status.trim()) return { kind: "nothing-to-commit" };
  // If nothing is staged yet, stage everything so the single-button flow
  // commits the user's full working tree.
  const cached = await gitOk(cwd, ["diff", "--cached", "--name-only"]);
  if (!cached.trim()) {
    await gitOk(cwd, ["add", "-A"]);
    const stagedAfter = await gitOk(cwd, ["diff", "--cached", "--name-only"]);
    if (!stagedAfter.trim()) return { kind: "nothing-to-commit" };
  }
  const message = (await generateCommitMessage(projectId)).trim();
  if (!message) throw new GitError("generated commit message was empty");
  await gitOk(cwd, ["commit", "-m", message], 30_000);
  const sha = (await gitOk(cwd, ["rev-parse", "HEAD"])).trim();
  return { kind: "committed", sha, message };
}

export type PushResult =
  | { kind: "pushed"; setUpstream: boolean; output: string }
  | { kind: "nothing-to-push" };

export async function push(projectId: string): Promise<PushResult> {
  const cwd = projectCwd(projectId);
  // If an upstream is configured and there are no unpushed commits, surface
  // that to the UI as a distinct kind rather than letting `git push` print
  // "Everything up-to-date".
  const ahead = await runGit(cwd, [
    "rev-list",
    "--count",
    "@{u}..HEAD",
  ]);
  if (ahead.code === 0 && ahead.stdout.trim() === "0") {
    return { kind: "nothing-to-push" };
  }
  const first = await runGit(cwd, ["push"], { timeoutMs: PUSH_TIMEOUT_MS });
  if (first.code === 0) {
    return { kind: "pushed", setUpstream: false, output: combineStreams(first) };
  }
  // Detect "no upstream" failure and retry with -u.
  const stderr = first.stderr || "";
  const noUpstream =
    /no upstream branch/i.test(stderr) ||
    /set the upstream/i.test(stderr) ||
    /--set-upstream/i.test(stderr);
  if (!noUpstream) {
    throw new GitError("git push failed", stderr.trim() || `exit ${first.code}`);
  }
  const branch = (await gitOk(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!branch || branch === "HEAD") {
    throw new GitError("cannot push: detached HEAD");
  }
  // No upstream configured — only push if HEAD has at least one commit to
  // publish. Otherwise an unborn or empty branch would surface as a generic
  // git error instead of "nothing to push".
  const headCount = await runGit(cwd, ["rev-list", "--count", "HEAD"]);
  if (headCount.code === 0 && headCount.stdout.trim() === "0") {
    return { kind: "nothing-to-push" };
  }
  const second = await runGit(cwd, ["push", "-u", "origin", branch], {
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  if (second.code !== 0) {
    throw new GitError(
      "git push failed",
      second.stderr.trim() || `exit ${second.code}`,
    );
  }
  return { kind: "pushed", setUpstream: true, output: combineStreams(second) };
}

function combineStreams(r: RunGitResult): string {
  return [r.stdout, r.stderr].map((s) => s.trim()).filter(Boolean).join("\n");
}

const COMMIT_MESSAGE_PROMPT = `You are generating a git commit message. Read the staged diff that follows the marker and respond with ONLY the commit message — no preamble, no quotes, no code fences.

Format: a single short subject line (50 chars or fewer, imperative mood, no trailing period). If the change is non-trivial, add a blank line and 1–4 short bullet points starting with "- " describing what changed and why. Do not invent details that are not in the diff.

--- STAGED DIFF ---
`;

async function generateCommitMessage(projectId: string): Promise<string> {
  const cwd = projectCwd(projectId);
  // Use stat-prefixed diff so the model gets a roof on size.
  const diff = await gitOk(cwd, ["diff", "--cached"], 30_000);
  if (!diff.trim()) throw new GitError("nothing staged");
  const trimmed =
    diff.length > COMMIT_MESSAGE_DIFF_BUDGET
      ? diff.slice(0, COMMIT_MESSAGE_DIFF_BUDGET) + "\n[diff truncated]\n"
      : diff;
  const raw = await runCli("claude", ["-p", COMMIT_MESSAGE_PROMPT + trimmed], {
    cwd,
    timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
  });
  return sanitizeCommitMessage(raw);
}

function sanitizeCommitMessage(raw: string): string {
  let t = raw.trim();
  // Strip leading/trailing code fences if the model wraps the answer.
  t = t.replace(/^```[a-zA-Z0-9]*\s*\n/, "").replace(/\n```$/m, "");
  // Strip wrapping quotes around the whole message.
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Surface stderr to API consumers without leaking the GitError class. */
export function gitErrorPayload(e: unknown): { message: string; stderr?: string } {
  if (e instanceof GitError) {
    return { message: e.message, stderr: e.stderr };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}
