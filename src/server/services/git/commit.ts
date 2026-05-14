import { runCli } from "../claude-cli";
import { getErrorMessage } from "../../lib/errors";
import {
  COMMIT_MESSAGE_DIFF_BUDGET,
  COMMIT_MESSAGE_TIMEOUT_MS,
  GitError,
  PUSH_TIMEOUT_MS,
  combineStreams,
  getGitWorkspace,
  gitOk,
  type GitWorkspace,
} from "./exec";

const gitMutationLocks = new Map<string, Promise<unknown>>();

export async function stageFiles(projectId: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await withGitMutationLock(projectId, async () => {
    const workspace = await getGitWorkspace(projectId);
    await gitOk(workspace, ["add", "--", ...files]);
  });
}

export async function deleteProjectFile(
  projectId: string,
  relPath: string,
): Promise<void> {
  if (!relPath || relPath.trim() === "") {
    throw new GitError("file path is required");
  }
  await withGitMutationLock(projectId, async () => {
    const workspace = await getGitWorkspace(projectId);
    try {
      await workspace.deleteFile(relPath);
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "ENOENT") return; // already gone
      if (code === "EISDIR") {
        throw new GitError("path is a directory");
      }
      throw new GitError("could not delete file", getErrorMessage(e));
    }
  });
}

export async function unstageFiles(projectId: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await withGitMutationLock(projectId, async () => {
    const workspace = await getGitWorkspace(projectId);
    // `git reset HEAD --` works whether or not HEAD has any history.
    const r = await workspace.runGit(["reset", "HEAD", "--", ...files]);
    // `git reset` exits 1 on partial when no HEAD yet; treat fatal errors only.
    if (r.code !== 0 && /fatal:/i.test(r.stderr)) {
      // Empty repo (no HEAD) — fall back to `rm --cached` to unstage.
      if (/ambiguous argument 'HEAD'/i.test(r.stderr)) {
        await gitOk(workspace, ["rm", "--cached", "--", ...files]);
        return;
      }
      throw new GitError("git reset failed", r.stderr.trim());
    }
  });
}

export type CommitResult =
  | { kind: "committed"; sha: string; message: string }
  | { kind: "nothing-to-commit" };

export async function commit(
  projectId: string,
  opts: { autoStage?: boolean } = {},
): Promise<CommitResult> {
  return withGitMutationLock(projectId, async () => commitUnlocked(projectId, opts));
}

async function commitUnlocked(
  projectId: string,
  opts: { autoStage?: boolean },
): Promise<CommitResult> {
  const { autoStage = true } = opts;
  const workspace = await getGitWorkspace(projectId);
  // Detect anything that could become a commit (staged or unstaged tracked
  // changes, or untracked files). If nothing, bail before invoking the LLM.
  const status = await gitOk(workspace, ["status", "--porcelain=v1", "-z"]);
  if (!status.trim()) return { kind: "nothing-to-commit" };
  if (autoStage) {
    await gitOk(workspace, ["add", "-A"]);
  }
  const cached = await gitOk(workspace, ["diff", "--cached", "--name-only"]);
  if (!cached.trim()) {
    return { kind: "nothing-to-commit" };
  }
  const message = (await generateCommitMessage(projectId, workspace)).trim();
  if (!message) throw new GitError("generated commit message was empty");
  await gitOk(workspace, ["commit", "-m", message], 30_000);
  const sha = (await gitOk(workspace, ["rev-parse", "HEAD"])).trim();
  return { kind: "committed", sha, message };
}

export type PushResult =
  | { kind: "pushed"; setUpstream: boolean; output: string }
  | { kind: "nothing-to-push" };

export async function push(projectId: string): Promise<PushResult> {
  return withGitMutationLock(projectId, async () => pushUnlocked(projectId));
}

async function pushUnlocked(projectId: string): Promise<PushResult> {
  const workspace = await getGitWorkspace(projectId);
  // If an upstream is configured and there are no unpushed commits, surface
  // that to the UI as a distinct kind rather than letting `git push` print
  // "Everything up-to-date".
  const ahead = await workspace.runGit([
    "rev-list",
    "--count",
    "@{u}..HEAD",
  ]);
  if (ahead.code === 0 && ahead.stdout.trim() === "0") {
    return { kind: "nothing-to-push" };
  }
  const first = await workspace.runGit(["push"], { timeoutMs: PUSH_TIMEOUT_MS });
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
  const branch = (await gitOk(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!branch || branch === "HEAD") {
    throw new GitError("cannot push: detached HEAD");
  }
  // No upstream configured — only push if HEAD has at least one commit to
  // publish. Otherwise an unborn or empty branch would surface as a generic
  // git error instead of "nothing to push".
  const headCount = await workspace.runGit(["rev-list", "--count", "HEAD"]);
  if (headCount.code === 0 && headCount.stdout.trim() === "0") {
    return { kind: "nothing-to-push" };
  }
  const second = await workspace.runGit(["push", "-u", "origin", branch], {
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

async function withGitMutationLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const previous = gitMutationLocks.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  gitMutationLocks.set(projectId, next);
  try {
    return await next;
  } finally {
    if (gitMutationLocks.get(projectId) === next) gitMutationLocks.delete(projectId);
  }
}

const COMMIT_MESSAGE_PROMPT = `You are generating a git commit message. Read the staged diff that follows the marker and respond with ONLY the commit message — no preamble, no quotes, no code fences.

Format: a single short subject line (50 chars or fewer, imperative mood, no trailing period). If the change is non-trivial, add a blank line and 1–4 short bullet points starting with "- " describing what changed and why. Do not invent details that are not in the diff.

--- STAGED DIFF ---
`;

async function generateCommitMessage(projectId: string, workspace: GitWorkspace): Promise<string> {
  // Use stat-prefixed diff so the model gets a roof on size.
  const diff = await gitOk(workspace, ["diff", "--cached"], 30_000);
  if (!diff.trim()) throw new GitError("nothing staged");
  const trimmed =
    diff.length > COMMIT_MESSAGE_DIFF_BUDGET
      ? diff.slice(0, COMMIT_MESSAGE_DIFF_BUDGET) + "\n[diff truncated]\n"
      : diff;
  if (workspace.kind === "daytona") return fallbackCommitMessage(diff);
  const raw = await runCli("claude", ["-p", COMMIT_MESSAGE_PROMPT + trimmed], {
    cwd: workspace.cwd,
    timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
  });
  return sanitizeCommitMessage(raw);
}

function fallbackCommitMessage(diff: string): string {
  const files = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2] ?? match[1]);
  if (files.length === 1 && files[0]) return `Update ${files[0].split("/").pop() ?? files[0]}`;
  if (files.length > 1) return `Update ${files.length} files`;
  return "Update project files";
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
