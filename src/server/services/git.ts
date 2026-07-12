import * as fs from "node:fs";
import * as path from "node:path";
import { spawnCapture } from "./_spawn";
import {
  CommitMessageGenerationError,
  resolveCommitCli,
  runCommitCli,
} from "./commit-cli";
import { COMMIT_CLI_LABEL, type CommitCli } from "~/shared/commit-cli";
import { DEFAULT_BRANCH } from "~/shared/domain";
import { buildGithubCompareUrl } from "~/shared/github-pr";
import { detectGithubUrl } from "./projects";
import { resolveProjectWorktreeCwd } from "./worktrees";
import {
  DIFF_MAX_BYTES,
  DIFF_MAX_LINES,
  parsePorcelainZ,
  parseGitBranchHeader,
  classifyDiffPatch,
  buildAdditionsDiff,
  bufferLooksBinary,
  changedFileCount,
} from "~/shared/git-status";

// parsePorcelainZ / parseGitBranchHeader are re-exported so existing importers
// (git.test.ts) keep working.
export { parsePorcelainZ, parseGitBranchHeader };

const GIT_TIMEOUT_MS = 15_000;
const PUSH_TIMEOUT_MS = 30_000;
const GH_TIMEOUT_MS = 30_000;
const PR_BASE_BRANCH = DEFAULT_BRANCH;
/** Cap staged-diff payload sent to the AI commit message generator. */
const COMMIT_MESSAGE_DIFF_BUDGET = 200_000;

// Git result types + diff caps now live in src/shared/git-status.ts so the
// remote sandbox agent shares the exact wire contract. Imported for this
// module's own signatures and re-exported for existing importers (GitDiffView,
// ~/queries/git, git.test.ts).
import type { GitFileStatus, GitChangedFile, GitStatus, GitDiff } from "~/shared/git-status";
export type { GitFileStatus, GitChangedFile, GitStatus, GitDiff };

class GitError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "GitError";
  }
}

/** A commit failed because the AI step couldn't produce a usable message.
 * Carries the CLI identity so the UI's error modal can show "Claude Code
 * failed — try Codex in Settings" without re-deriving the choice. */
export class CommitGenerationFailedError extends Error {
  constructor(
    message: string,
    public readonly cli: CommitCli,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "CommitGenerationFailedError";
  }
}

/** Shown to the user when no supported CLI is on PATH at all. */
export class NoCommitCliInstalledError extends Error {
  constructor() {
    super("no supported commit CLI is installed");
    this.name = "NoCommitCliInstalledError";
  }
}

function projectCwd(projectId: string, worktreeId?: string | null): string {
  try {
    return resolveProjectWorktreeCwd(projectId, worktreeId);
  } catch (e) {
    throw new GitError(e instanceof Error ? e.message : String(e));
  }
}

type RunGitResult = { stdout: string; stderr: string; code: number };

function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; encoding?: "utf8" | "buffer" } = {},
): Promise<RunGitResult> {
  const { timeoutMs = GIT_TIMEOUT_MS } = options;
  return spawnCapture("git", args, {
    cwd,
    timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    onTimeout: () => new GitError(`git ${args[0]} timed out`),
  });
}

async function countCommitsBetween(
  cwd: string,
  fromRef: string,
  toRef: string,
): Promise<number | null> {
  const r = await runGit(cwd, ["rev-list", "--count", `${fromRef}..${toRef}`]);
  if (r.code !== 0) return null;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function resolveBaseRef(cwd: string, base: string): Promise<string | null> {
  for (const ref of [base, `origin/${base}`]) {
    const r = await runGit(cwd, ["rev-parse", "--verify", ref]);
    if (r.code === 0 && r.stdout.trim()) return ref;
  }
  return null;
}

async function countCommitsAheadOfBase(cwd: string, base: string): Promise<number | null> {
  const baseRef = await resolveBaseRef(cwd, base);
  if (!baseRef) return null;
  return countCommitsBetween(cwd, baseRef, "HEAD");
}

async function workingTreeDirty(cwd: string): Promise<boolean> {
  const r = await runGit(cwd, ["status", "--porcelain"]);
  return r.code === 0 && r.stdout.trim().length > 0;
}

async function remoteBranchExists(cwd: string, branch: string): Promise<boolean> {
  const r = await runGit(cwd, ["ls-remote", "--heads", "origin", branch]);
  return r.code === 0 && r.stdout.trim().length > 0;
}

function assertPullRequestHasCommits(opts: {
  branch: string;
  baseBranch: string;
  aheadOfBase: number | null;
  dirty: boolean;
}): void {
  const { branch, baseBranch, aheadOfBase, dirty } = opts;
  if (aheadOfBase === null) return;
  if (aheadOfBase > 0) return;
  if (dirty) {
    throw new GitError(
      `Branch "${branch}" has no commits ahead of ${baseBranch} yet. Accept your changes in Review Changes, then use Ship to commit and push before opening a pull request.`,
    );
  }
  throw new GitError(
    `Branch "${branch}" has no commits ahead of ${baseBranch}. Commit your work with Ship before opening a pull request.`,
  );
}

async function gitOk(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await runGit(cwd, args, { timeoutMs });
  if (r.code !== 0) {
    throw new GitError(`git ${args[0]} failed`, r.stderr.trim() || `exit ${r.code}`);
  }
  return r.stdout;
}

// A directory doesn't stop being a work tree mid-session, so cache the positive
// `rev-parse --is-inside-work-tree` result per cwd for the process lifetime —
// this drops one spawn from every getGitStatus poll (and every branch/pull op)
// after the first. Only successes are cached; a later git failure on the same
// cwd invalidates it (see invalidateWorkTreeCache) so a repo that genuinely
// went away is re-checked.
const workTreeCache = new Map<string, boolean>();

function invalidateWorkTreeCache(cwd: string): void {
  workTreeCache.delete(cwd);
}

async function assertGitRepository(cwd: string): Promise<void> {
  if (workTreeCache.get(cwd)) return;
  const r = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (r.code === 0 && r.stdout.trim() === "true") {
    workTreeCache.set(cwd, true);
    return;
  }
  workTreeCache.delete(cwd);
  throw new GitError(
    "Project folder is not a Git repository.",
    r.stderr.trim() || "Run git init in this folder to enable branches and worktrees.",
  );
}

async function currentBranchName(cwd: string): Promise<string> {
  const symbolic = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (symbolic.code === 0 && symbolic.stdout.trim()) return symbolic.stdout.trim();
  const abbreviated = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (abbreviated.code === 0 && abbreviated.stdout.trim()) return abbreviated.stdout.trim();
  return "HEAD";
}

// mapStatusCode + parsePorcelainZ now live in ~/shared/git-status (imported and
// re-exported above) so the remote agent's git RPC parses identically.

export async function getGitStatus(projectId: string, worktreeId?: string | null): Promise<GitStatus> {
  const cwd = projectCwd(projectId, worktreeId);
  await assertGitRepository(cwd);
  // `-b` prepends a `## <branch>...<upstream> [ahead N, behind M]` header to the
  // same porcelain output, so one spawn yields the branch name AND the
  // ahead/behind counts against the upstream — replacing the old symbolic-ref +
  // two rev-list spawns. In `-z` mode the header is the first NUL-terminated
  // token; the file entries follow and still feed parsePorcelainZ unchanged.
  let statusOut: string;
  try {
    statusOut = await gitOk(cwd, ["status", "--porcelain=v1", "-b", "-z", "-uall"]);
  } catch (e) {
    // The dir may have stopped being a work tree (e.g. .git removed); drop the
    // cached positive so the next call re-checks.
    invalidateWorkTreeCache(cwd);
    throw e;
  }
  const nul = statusOut.indexOf("\0");
  const headerLine = nul >= 0 ? statusOut.slice(0, nul) : statusOut;
  const entriesOut = nul >= 0 ? statusOut.slice(nul + 1) : "";
  const header = parseGitBranchHeader(headerLine);
  const { staged, unstaged } = parsePorcelainZ(entriesOut);
  // With an upstream the header already carries both counts. Without one, the
  // header omits them: preserve the old fallback — ahead against origin/main →
  // main (one extra spawn, only in the no-upstream case), behind stays null (no
  // tracking ref to measure against, exactly as before).
  const aheadCount = header.hasUpstream ? header.ahead : await countAhead(cwd);
  const behindCount = header.hasUpstream ? header.behind : null;
  return {
    branch: header.branch || "HEAD",
    staged,
    unstaged,
    changedCount: changedFileCount(staged, unstaged),
    aheadCount,
    behindCount,
  };
}

// No-upstream fallback for the ahead count: the branch header supplies ahead/
// behind whenever an upstream exists, so this only runs when it doesn't — and
// `@{u}` would necessarily fail there. Mirror the old fallback order
// (origin/main → main) so a fresh feature branch still reports commits ahead of
// the default branch.
async function countAhead(cwd: string): Promise<number | null> {
  for (const target of ["origin/main", "main"]) {
    const r = await runGit(cwd, ["rev-list", "--count", `${target}..HEAD`]);
    if (r.code === 0) {
      const n = parseInt(r.stdout.trim(), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export async function getGitDiff(
  projectId: string,
  file: string,
  staged: boolean,
  worktreeId?: string | null,
): Promise<GitDiff> {
  const cwd = projectCwd(projectId, worktreeId);

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
  return classifyDiffPatch(r.stdout);
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
    if (bufferLooksBinary(buf)) return { kind: "binary" };
    const text = buf.toString("utf8");
    const lineCount = text.split("\n").length;
    if (lineCount > DIFF_MAX_LINES) {
      return { kind: "too-large", lines: lineCount, bytes: stat.size };
    }
    return { kind: "text", patch: buildAdditionsDiff(file, text), truncated: false };
  } catch (e: any) {
    throw new GitError("could not read untracked file", e?.message || String(e));
  }
}

export async function stageFiles(
  projectId: string,
  files: string[],
  worktreeId?: string | null,
): Promise<void> {
  if (files.length === 0) return;
  const cwd = projectCwd(projectId, worktreeId);
  await gitOk(cwd, ["add", "--", ...files]);
}

export async function deleteProjectFile(
  projectId: string,
  relPath: string,
  worktreeId?: string | null,
): Promise<void> {
  if (!relPath || relPath.trim() === "") {
    throw new GitError("file path is required");
  }
  const cwd = projectCwd(projectId, worktreeId);
  const abs = path.resolve(cwd, relPath);
  const rootWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (abs !== cwd && !abs.startsWith(rootWithSep)) {
    throw new GitError("path escapes project root");
  }
  if (abs === cwd) {
    throw new GitError("refusing to delete project root");
  }
  // The lexical check above collapses `..`, but a *symlinked intermediate
  // directory* inside the repo (e.g. `link -> /etc`, then delete `link/passwd`)
  // resolves lexically inside root while `fs.rm` follows it out of the project.
  // Realpath the parent directory and re-check containment so the delete target
  // physically lives under the project root.
  try {
    const realRoot = fs.realpathSync(cwd);
    const realParent = fs.realpathSync(path.dirname(abs));
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    if (realParent !== realRoot && !realParent.startsWith(realRootWithSep)) {
      throw new GitError("path escapes project root");
    }
  } catch (e: any) {
    if (e instanceof GitError) throw e;
    if (e?.code === "ENOENT") return; // parent already gone → nothing to delete
    throw new GitError("could not resolve file path", e?.message || String(e));
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

export async function unstageFiles(
  projectId: string,
  files: string[],
  worktreeId?: string | null,
): Promise<void> {
  if (files.length === 0) return;
  const cwd = projectCwd(projectId, worktreeId);
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

export async function commit(
  projectId: string,
  opts: {
    autoStage?: boolean;
    worktreeId?: string | null;
    /** When supplied, skip CLI generation and use this verbatim as the commit message. */
    message?: string;
  } = {},
): Promise<CommitResult> {
  const { autoStage = true } = opts;
  const cwd = projectCwd(projectId, opts.worktreeId);
  // Detect anything that could become a commit (staged or unstaged tracked
  // changes, or untracked files). If nothing, bail before invoking the LLM.
  const status = await gitOk(cwd, ["status", "--porcelain=v1", "-z"]);
  if (!status.trim()) return { kind: "nothing-to-commit" };
  if (autoStage) {
    await gitOk(cwd, ["add", "-A"]);
  }
  const cached = await gitOk(cwd, ["diff", "--cached", "--name-only"]);
  if (!cached.trim()) {
    return { kind: "nothing-to-commit" };
  }
  const manual = opts.message?.trim();
  const message = manual && manual.length > 0
    ? manual
    : (await generateCommitMessage(projectId, opts.worktreeId)).trim();
  if (!message) throw new GitError("generated commit message was empty");
  await gitOk(cwd, ["commit", "-m", message], 30_000);
  const sha = (await gitOk(cwd, ["rev-parse", "HEAD"])).trim();
  return { kind: "committed", sha, message };
}

export type PushResult =
  | { kind: "pushed"; setUpstream: boolean; output: string }
  | { kind: "nothing-to-push" };

export type FetchResult = {
  kind: "fetched";
  output: string;
};

export type PullResult =
  | { kind: "pulled"; output: string }
  | { kind: "already-up-to-date"; output: string };

export type CreatePullRequestResult =
  | { kind: "created"; url: string }
  | { kind: "exists"; url: string }
  | {
      kind: "gh-missing";
      compareUrl: string;
      branch: string;
      baseBranch: string;
    };

/** Update remote-tracking refs without merging into the working tree. */
export async function fetchRemote(
  projectId: string,
  worktreeId?: string | null,
): Promise<FetchResult> {
  const cwd = projectCwd(projectId, worktreeId);
  await assertGitRepository(cwd);
  // No remote arg — git uses the current branch upstream / origin by default.
  const result = await runGit(cwd, ["fetch", "--prune"], {
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new GitError("git fetch failed", result.stderr.trim() || `exit ${result.code}`);
  }
  return { kind: "fetched", output: combineStreams(result) };
}

export type PullMode = "ff-only" | "rebase" | "merge";

/**
 * Rebase/merge pulls create a commit, which git refuses to do when no
 * committer identity is configured ("empty ident name … not allowed") — common
 * on fresh machines, sandboxes, and CI runners. Inject a throwaway identity for
 * *only* the fields git can't already resolve, so a configured user.name/email
 * is always preferred and left untouched.
 */
async function fallbackIdentityArgs(cwd: string): Promise<string[]> {
  const [name, email] = await Promise.all([
    runGit(cwd, ["config", "user.name"]),
    runGit(cwd, ["config", "user.email"]),
  ]);
  const args: string[] = [];
  if (!(name.code === 0 && name.stdout.trim())) {
    args.push("-c", "user.name=Mission Control");
  }
  if (!(email.code === 0 && email.stdout.trim())) {
    args.push("-c", "user.email=mission-control@localhost");
  }
  return args;
}

/**
 * Pull the current branch from its upstream (or origin/<branch>).
 * Default is fast-forward only; rebase/merge are explicit so a header click
 * never invents a merge commit unless the user asked for it.
 */
export async function pull(
  projectId: string,
  worktreeId?: string | null,
  mode: PullMode = "ff-only",
): Promise<PullResult> {
  const cwd = projectCwd(projectId, worktreeId);
  await assertGitRepository(cwd);
  const branch = await currentBranchName(cwd);
  if (!branch || branch === "HEAD") {
    throw new GitError("cannot pull: detached HEAD");
  }

  const modeArgs =
    mode === "rebase" ? ["--rebase"] : mode === "merge" ? ["--no-rebase"] : ["--ff-only"];

  // ff-only never commits; rebase/merge can, so give git a fallback identity.
  const identityArgs = mode === "ff-only" ? [] : await fallbackIdentityArgs(cwd);

  let result = await runGit(cwd, [...identityArgs, "pull", ...modeArgs], {
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const noUpstream =
      /no tracking information|There is no tracking information|no upstream/i.test(
        result.stderr || "",
      ) || /set the upstream/i.test(result.stderr || "");
    if (noUpstream) {
      result = await runGit(cwd, [...identityArgs, "pull", ...modeArgs, "origin", branch], {
        timeoutMs: PUSH_TIMEOUT_MS,
      });
    }
  }
  if (result.code !== 0) {
    const stderr = result.stderr.trim() || `exit ${result.code}`;
    const diverged =
      /Not possible to fast-forward|diverging branches|diverged|need to specify how to reconcile/i.test(
        stderr,
      );
    const conflict = /conflict|CONFLICT|could not apply|fix conflicts/i.test(stderr);
    if (mode === "ff-only" && diverged) {
      throw new GitError(
        "Branch has diverged from remote — use Pull with rebase or Pull with merge.",
        stderr,
      );
    }
    if (conflict) {
      throw new GitError(
        "Pull hit conflicts — resolve them in a terminal, then continue the rebase/merge.",
        stderr,
      );
    }
    throw new GitError("git pull failed", stderr);
  }
  const output = combineStreams(result);
  if (/Already up.to.date/i.test(output) || !output.trim()) {
    return { kind: "already-up-to-date", output: output || "Already up to date." };
  }
  return { kind: "pulled", output };
}

export async function push(projectId: string, worktreeId?: string | null): Promise<PushResult> {
  const cwd = projectCwd(projectId, worktreeId);
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

function runGh(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<RunGitResult> {
  const { timeoutMs = GH_TIMEOUT_MS } = options;
  return spawnCapture("gh", args, {
    cwd,
    timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    onTimeout: () => new GitError(`gh ${args[0]} timed out`),
    enoentCode: 127,
  });
}

function parseGhUrl(stdout: string): string | null {
  const match = stdout.match(/https:\/\/github\.com\/[^\s]+/);
  return match?.[0]?.replace(/[)\].,]+$/, "") ?? null;
}

async function isGhInstalled(cwd: string): Promise<boolean> {
  const r = await runGh(cwd, ["--version"]);
  return r.code === 0;
}

async function existingPullRequestUrl(cwd: string, branch: string): Promise<string | null> {
  const r = await runGh(cwd, ["pr", "view", "--head", branch, "--json", "url", "-q", ".url"]);
  if (r.code !== 0) return null;
  const url = r.stdout.trim();
  return url.startsWith("https://") ? url : null;
}

export async function createPullRequest(
  projectId: string,
  worktreeId?: string | null,
): Promise<CreatePullRequestResult> {
  const cwd = projectCwd(projectId, worktreeId);
  const branch = (await gitOk(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!branch || branch === "HEAD") {
    throw new GitError("cannot create pull request from detached HEAD");
  }
  if (branch === PR_BASE_BRANCH) {
    throw new GitError(`already on ${PR_BASE_BRANCH}; switch to a feature branch first`);
  }

  const githubUrl = detectGithubUrl(cwd);
  if (!githubUrl) {
    throw new GitError("could not detect a GitHub origin for this repository");
  }
  const compareUrl = buildGithubCompareUrl(githubUrl, PR_BASE_BRANCH, branch);

  if (!(await isGhInstalled(cwd))) {
    return {
      kind: "gh-missing",
      compareUrl,
      branch,
      baseBranch: PR_BASE_BRANCH,
    };
  }

  const [aheadOfBase, dirty] = await Promise.all([
    countCommitsAheadOfBase(cwd, PR_BASE_BRANCH),
    workingTreeDirty(cwd),
  ]);
  assertPullRequestHasCommits({
    branch,
    baseBranch: PR_BASE_BRANCH,
    aheadOfBase,
    dirty,
  });

  const existing = await existingPullRequestUrl(cwd, branch);
  if (existing) {
    return { kind: "exists", url: existing };
  }

  // Publish any local commits before asking gh to open the PR.
  try {
    await push(projectId, worktreeId);
  } catch (e) {
    throw e instanceof GitError ? e : new GitError("git push failed before creating pull request");
  }

  if (!(await remoteBranchExists(cwd, branch))) {
    throw new GitError(
      `Branch "${branch}" is not on origin yet. Use Ship to commit and push your changes, then try creating the pull request again.`,
    );
  }

  const created = await runGh(
    cwd,
    ["pr", "create", "--base", PR_BASE_BRANCH, "--fill"],
    { timeoutMs: GH_TIMEOUT_MS },
  );
  if (created.code !== 0) {
    const stderr = created.stderr.trim();
    const alreadyExists =
      /already exists/i.test(stderr) ||
      /A pull request for .+ already exists/i.test(stderr);
    if (alreadyExists) {
      const url = (await existingPullRequestUrl(cwd, branch)) ?? parseGhUrl(created.stdout);
      if (url) return { kind: "exists", url };
    }
    throw new GitError("gh pr create failed", stderr || `exit ${created.code}`);
  }

  const url = parseGhUrl(created.stdout) ?? (await existingPullRequestUrl(cwd, branch));
  if (!url) {
    throw new GitError("pull request was created but no URL was returned");
  }
  return { kind: "created", url };
}

function combineStreams(r: RunGitResult): string {
  return [r.stdout, r.stderr].map((s) => s.trim()).filter(Boolean).join("\n");
}

const COMMIT_MESSAGE_PROMPT = `You are generating a git commit message. Read the staged diff that follows the marker and respond with ONLY the commit message — no preamble, no quotes, no code fences.

Format: a single short subject line (50 chars or fewer, imperative mood, no trailing period). If the change is non-trivial, add a blank line and 1–4 short bullet points starting with "- " describing what changed and why. Do not invent details that are not in the diff.

--- STAGED DIFF ---
`;

async function generateCommitMessage(projectId: string, worktreeId?: string | null): Promise<string> {
  const cwd = projectCwd(projectId, worktreeId);
  const diff = await gitOk(cwd, ["diff", "--cached"], 30_000);
  if (!diff.trim()) throw new GitError("nothing staged");
  const trimmed =
    diff.length > COMMIT_MESSAGE_DIFF_BUDGET
      ? diff.slice(0, COMMIT_MESSAGE_DIFF_BUDGET) + "\n[diff truncated]\n"
      : diff;

  const { cli } = await resolveCommitCli();
  if (!cli) {
    // Zero supported CLIs reachable — surface a typed error so the UI
    // routes the user to Settings (or the manual-message bypass).
    throw new NoCommitCliInstalledError();
  }
  console.info(`[commit-cli] generating commit message via ${cli}`);
  let raw: string;
  try {
    raw = await runCommitCli(cli, COMMIT_MESSAGE_PROMPT + trimmed, { cwd });
  } catch (e) {
    if (e instanceof CommitMessageGenerationError) {
      throw new CommitGenerationFailedError(
        `${COMMIT_CLI_LABEL[e.cli]} failed to generate a commit message`,
        e.cli,
        e.stderr,
      );
    }
    throw e;
  }
  const sanitized = sanitizeCommitMessage(raw);
  if (!sanitized) {
    throw new CommitGenerationFailedError(
      `${COMMIT_CLI_LABEL[cli]} returned an empty commit message`,
      cli,
    );
  }
  return sanitized;
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

export type GitBranch = {
  /** Short branch name used for checkout (e.g. `main`, `feat/foo`). */
  name: string;
  local: boolean;
  /** Remote tracking ref when known (e.g. `origin/main`). */
  remoteRef?: string;
};

export type GitBranchesResult = {
  current: string;
  branches: GitBranch[];
};

export type GitCheckoutResult = {
  branch: string;
  created: boolean;
};

export type GitErrorPayload = {
  message: string;
  stderr?: string;
  /** Identifies an AI-generation failure so the UI can render the recovery dialog. */
  kind?: "commit-generation-failed" | "no-commit-cli";
  /** Which CLI was tried when kind === "commit-generation-failed". */
  cli?: CommitCli;
};

/** Merge local and remote branch lists into deduplicated checkout targets. */
export function parseBranchList(localRaw: string, remoteRaw: string): GitBranch[] {
  const localNames = localRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const byName = new Map<string, GitBranch>();
  for (const name of localNames) {
    byName.set(name, { name, local: true });
  }
  for (const line of remoteRaw.split("\n")) {
    const ref = line.trim();
    if (!ref || ref.includes("HEAD ->")) continue;
    const slash = ref.indexOf("/");
    if (slash <= 0) continue;
    const name = ref.slice(slash + 1);
    if (!name) continue;
    const existing = byName.get(name);
    if (existing) {
      existing.remoteRef = ref;
      continue;
    }
    byName.set(name, { name, local: false, remoteRef: ref });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  const r = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.code === 0;
}

async function resolveRemoteTrackingRef(cwd: string, branch: string): Promise<string | null> {
  for (const remote of ["origin", "upstream"]) {
    const ref = `${remote}/${branch}`;
    const r = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/${ref}`]);
    if (r.code === 0) return ref;
  }
  return null;
}

async function assertValidBranchName(cwd: string, branch: string): Promise<void> {
  const r = await runGit(cwd, ["check-ref-format", "--branch", branch]);
  if (r.code !== 0) {
    throw new GitError(`Invalid branch name "${branch}"`, r.stderr.trim() || undefined);
  }
}

async function listBranchRefNames(cwd: string, refPrefix: string): Promise<string> {
  const r = await runGit(cwd, ["for-each-ref", "--format=%(refname:short)", refPrefix]);
  return r.code === 0 ? r.stdout : "";
}

export async function listGitBranches(
  projectId: string,
  worktreeId?: string | null,
): Promise<GitBranchesResult> {
  const cwd = projectCwd(projectId, worktreeId);
  await assertGitRepository(cwd);
  const [localOut, remoteOut, currentOut] = await Promise.all([
    listBranchRefNames(cwd, "refs/heads/"),
    listBranchRefNames(cwd, "refs/remotes/"),
    currentBranchName(cwd),
  ]);
  return {
    current: currentOut || "HEAD",
    branches: parseBranchList(localOut, remoteOut),
  };
}

export async function checkoutGitBranch(
  projectId: string,
  branchName: string,
  worktreeId?: string | null,
  opts: { create?: boolean } = {},
): Promise<GitCheckoutResult> {
  const cwd = projectCwd(projectId, worktreeId);
  await assertGitRepository(cwd);
  const name = branchName.trim();
  if (!name) throw new GitError("Branch name cannot be empty");
  await assertValidBranchName(cwd, name);

  const current = await currentBranchName(cwd);
  if (current === name) return { branch: name, created: false };

  if (await localBranchExists(cwd, name)) {
    await gitOk(cwd, ["switch", name]);
    return { branch: name, created: false };
  }

  const remoteRef = await resolveRemoteTrackingRef(cwd, name);
  if (remoteRef) {
    await gitOk(cwd, ["switch", "--track", remoteRef]);
    return { branch: name, created: false };
  }

  if (opts.create) {
    await gitOk(cwd, ["switch", "-c", name]);
    return { branch: name, created: true };
  }

  throw new GitError(
    `Branch "${name}" was not found locally or on the remote.`,
    "Create it by choosing the create option or typing a new branch name.",
  );
}

/** Surface stderr to API consumers without leaking the GitError class. */
export function gitErrorPayload(e: unknown): GitErrorPayload {
  if (e instanceof CommitGenerationFailedError) {
    return {
      message: e.message,
      stderr: e.stderr,
      kind: "commit-generation-failed",
      cli: e.cli,
    };
  }
  if (e instanceof NoCommitCliInstalledError) {
    return { message: e.message, kind: "no-commit-cli" };
  }
  if (e instanceof GitError) {
    return { message: e.message, stderr: e.stderr };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}
