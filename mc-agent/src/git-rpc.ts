import { spawn } from "node:child_process";
import * as fs from "node:fs";
import {
  parsePorcelainZ,
  changedFileCount,
  classifyDiffPatch,
  buildAdditionsDiff,
  DIFF_MAX_BYTES,
  DIFF_MAX_LINES,
  type GitStatus,
  type GitDiff,
} from "../../src/shared/git-status";
import { resolveInsideWorkspace, isSafeBranchName, isSafeSlug } from "./workspace-guard";
import { log } from "./logger";

const GIT_TIMEOUT_MS = 15_000;
const CLONE_TIMEOUT_MS = 120_000;
const BINARY_SNIFF_BYTES = 8192;

// Only fetch over http(s) or SSH. Blocks git's `ext::`/`file::`
// transports, which can execute commands at clone time or read local files.
const CLONE_ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ssh:"]);
const SSH_USER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SSH_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const SSH_REPO_PATH = /^(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]+(?:\.git)?$/;
const SSH_SCP_REMOTE = new RegExp(
  `^(${SSH_USER.source.slice(1, -1)})@(${SSH_HOST.source.slice(1, -1)}):(${SSH_REPO_PATH.source.slice(1, -1)})$`,
);

type RunGitResult = { stdout: string; stderr: string; code: number };
type RunGitOptions = { timeoutMs?: number; extraEnv?: Record<string, string> };

/**
 * Spawn git directly (no shell) with a MINIMAL, allowlisted environment — never
 * the agent's full process.env, so MC_PAIRING_TOKEN / MC_* and other secrets are
 * not handed to git subprocesses (or, transitively, to a clone transport helper).
 */
function runGit(cwd: string, args: string[], opts: RunGitOptions = {}): Promise<RunGitResult> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C",
    GIT_TERMINAL_PROMPT: "0",
    ...opts.extraEnv,
  };
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`git ${args[0]} timed out`));
    }, opts.timeoutMs ?? GIT_TIMEOUT_MS);
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

/** Strip any embedded credentials from a remote URL before it touches a log. */
function redactRemote(remote: string): string {
  try {
    const u = new URL(remote);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    const scp = remote.match(SSH_SCP_REMOTE);
    return scp ? `${scp[1] === "git" ? "git" : "<user>"}@${scp[2]}:${scp[3]}` : "<unparseable>";
  }
}

/**
 * git's stderr echoes the clone URL verbatim on failure (e.g. "fatal: could not
 * read Username for 'https://user:pass@host'"), so it can carry the credentials a
 * user pasted into the remote. Scrub them before the message travels back over the
 * WS and gets rendered in the UI: replace the exact remote, then strip any leftover
 * `scheme://userinfo@` substring.
 */
function scrubCloneError(stderr: string, remote: string): string {
  return stderr
    .split(remote)
    .join(redactRemote(remote))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#'"]+)[?#][^\s'"]+/gi, "$1")
    .trim();
}

export type GitCloneOutcome = { slug: string; path: string };

function validateCloneRemote(remote: string): void {
  if (SSH_SCP_REMOTE.test(remote)) return;

  let parsed: URL;
  try {
    parsed = new URL(remote);
  } catch {
    throw new Error("invalid remote: must be an http(s) URL or SSH remote");
  }

  if (!CLONE_ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`unsupported remote protocol: ${parsed.protocol} (only http/https/ssh)`);
  }

  if (parsed.protocol === "ssh:") {
    const path = parsed.pathname.replace(/^\/+/, "");
    const userOk = parsed.username === "" || SSH_USER.test(parsed.username);
    if (parsed.password || !userOk || !SSH_HOST.test(parsed.hostname) || !SSH_REPO_PATH.test(path)) {
      throw new Error("unsupported SSH remote: expected ssh://[user@]host/owner/repo.git");
    }
  }
}

function assertCloneDestinationAvailable(dest: string): void {
  if (!fs.existsSync(dest)) return;
  const stat = fs.statSync(dest);
  if (!stat.isDirectory()) throw new Error("clone destination already exists and is not a directory");
  if (fs.readdirSync(dest).length > 0) throw new Error("clone destination already exists");
}

/**
 * Git status/diff/clone confined to the sandbox workspace, served over WS RPC.
 * Methods throw on failure (invalid path, git error); the WS dispatcher maps a
 * throw to an `{ ok: false, error }` rpcResult. Parsing + diff classification
 * reuse ~/shared/git-status so the wire contract matches the host HTTP API.
 */
export class GitRpc {
  /** Slugs with a clone in flight — guards the existsSync TOCTOU under retries. */
  private readonly cloning = new Set<string>();

  constructor(private readonly workspaceRoot: string) {}

  private repoCwd(repo: string): string {
    const abs = resolveInsideWorkspace(this.workspaceRoot, repo);
    if (!abs) throw new Error("repo path is outside the workspace");
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error("repo path does not exist");
    }
    if (!stat.isDirectory()) throw new Error("repo path is not a directory");
    return abs;
  }

  // Pathspecs are passed literally (GIT_LITERAL_PATHSPECS=1) so a client-supplied
  // `file` can't use git pathspec magic (`:(exclude)…`) to widen the diff.
  private async gitRead(cwd: string, args: string[]): Promise<string> {
    const r = await runGit(cwd, args, { extraEnv: { GIT_LITERAL_PATHSPECS: "1" } });
    if (r.code !== 0) {
      throw new Error(`git ${args[0]} failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    }
    return r.stdout;
  }

  private async countAhead(cwd: string): Promise<number | null> {
    for (const target of ["@{u}", "origin/main", "main"]) {
      const r = await runGit(cwd, ["rev-list", "--count", `${target}..HEAD`]);
      if (r.code === 0) {
        const n = Number.parseInt(r.stdout.trim(), 10);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  async status(params: { repo: string }): Promise<GitStatus> {
    const cwd = this.repoCwd(params.repo);
    const [statusOut, branchOut, aheadCount] = await Promise.all([
      this.gitRead(cwd, ["status", "--porcelain=v1", "-uall", "-z"]),
      this.gitRead(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD\n"),
      this.countAhead(cwd),
    ]);
    const { staged, unstaged } = parsePorcelainZ(statusOut);
    return {
      branch: branchOut.trim() || "HEAD",
      staged,
      unstaged,
      changedCount: changedFileCount(staged, unstaged),
      aheadCount,
    };
  }

  async diff(params: { repo: string; file: string; staged?: boolean }): Promise<GitDiff> {
    const cwd = this.repoCwd(params.repo);
    const { file, staged = false } = params;
    if (!resolveInsideWorkspace(cwd, file)) {
      throw new Error("diff path is outside the repo");
    }

    if (!staged) {
      const statusOut = await this.gitRead(cwd, ["status", "--porcelain=v1", "-z", "--", file]);
      if (statusOut.startsWith("??")) return this.readUntracked(cwd, file);
    }

    const args = staged ? ["diff", "--cached", "--", file] : ["diff", "--", file];
    const r = await runGit(cwd, args, { extraEnv: { GIT_LITERAL_PATHSPECS: "1" } });
    if (r.code !== 0) {
      throw new Error(`git diff failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    }
    return classifyDiffPatch(r.stdout);
  }

  private readUntracked(cwd: string, file: string): GitDiff {
    const abs = resolveInsideWorkspace(cwd, file);
    if (!abs) throw new Error("untracked path is outside the repo");
    const stat = fs.statSync(abs);
    if (stat.size > DIFF_MAX_BYTES) return { kind: "too-large", lines: 0, bytes: stat.size };
    const buf = fs.readFileSync(abs);
    const sniff = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES));
    if (sniff.includes(0)) return { kind: "binary" };
    const text = buf.toString("utf8");
    const lineCount = text.split("\n").length;
    if (lineCount > DIFF_MAX_LINES) return { kind: "too-large", lines: lineCount, bytes: stat.size };
    return { kind: "text", patch: buildAdditionsDiff(file, text), truncated: false };
  }

  async clone(params: { remote: string; slug: string; branch?: string }): Promise<GitCloneOutcome> {
    const { remote, slug, branch } = params;
    if (typeof remote !== "string") throw new Error("invalid remote");
    validateCloneRemote(remote);
    if (!isSafeSlug(slug)) throw new Error("invalid slug");
    if (branch !== undefined && !isSafeBranchName(branch)) throw new Error("invalid branch");

    const dest = resolveInsideWorkspace(this.workspaceRoot, slug);
    if (!dest) throw new Error("clone destination is outside the workspace");
    if (this.cloning.has(slug)) throw new Error("clone already in progress for this slug");
    assertCloneDestinationAvailable(dest);

    this.cloning.add(slug);
    const startedAt = Date.now();
    log("info", "git.clone.start", { slug, remote: redactRemote(remote) });
    try {
      // `--` separates options from the remote; GIT_ALLOW_PROTOCOL pins transports;
      // GIT_TERMINAL_PROMPT=0 makes auth failures fail fast instead of blocking the
      // RPC on an (invisible, in-container) username/password prompt.
      const cloneArgs = ["clone"];
      if (branch) cloneArgs.push("-b", branch);
      cloneArgs.push("--", remote, slug);
      const r = await runGit(this.workspaceRoot, cloneArgs, {
        timeoutMs: CLONE_TIMEOUT_MS,
        extraEnv: {
          GIT_ALLOW_PROTOCOL: "http:https:ssh",
          GIT_PROTOCOL_FROM_USER: "0",
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
        },
      });
      if (r.code !== 0) {
        log("error", "git.clone.fail", { slug, durationMs: Date.now() - startedAt });
        throw new Error(`git clone failed: ${scrubCloneError(r.stderr, remote) || `exit ${r.code}`}`);
      }
      log("info", "git.clone.ok", { slug, durationMs: Date.now() - startedAt });
      return { slug, path: dest };
    } finally {
      this.cloning.delete(slug);
    }
  }
}
