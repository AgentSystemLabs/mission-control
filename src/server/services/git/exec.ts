import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { getProjectRow } from "../projects";

export const GIT_TIMEOUT_MS = 15_000;
export const PUSH_TIMEOUT_MS = 30_000;
export const COMMIT_MESSAGE_TIMEOUT_MS = 60_000;
/** Cap diff bodies so a giant lockfile diff can't lock the renderer. */
export const DIFF_MAX_BYTES = 2 * 1024 * 1024;
export const DIFF_MAX_LINES = 50_000;
/** Cap staged-diff payload sent to the AI commit message generator. */
export const COMMIT_MESSAGE_DIFF_BUDGET = 200_000;

export class GitError extends Error {
  constructor(message: string, public stderr?: string) {
    super(message);
    this.name = "GitError";
  }
}

export function projectCwd(projectId: string): string {
  const p = getProjectRow(projectId);
  if (!p) throw new GitError("project not found");
  if (!p.path || !fs.existsSync(p.path)) {
    throw new GitError("project path does not exist on disk");
  }
  return p.path;
}

export type RunGitResult = { stdout: string; stderr: string; code: number };

export function runGit(
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

export async function gitOk(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await runGit(cwd, args, { timeoutMs });
  if (r.code !== 0) {
    throw new GitError(`git ${args[0]} failed`, r.stderr.trim() || `exit ${r.code}`);
  }
  return r.stdout;
}

export function combineStreams(r: RunGitResult): string {
  return [r.stdout, r.stderr].map((s) => s.trim()).filter(Boolean).join("\n");
}

/** Surface stderr to API consumers without leaking the GitError class. */
export function gitErrorPayload(e: unknown): { message: string; stderr?: string } {
  if (e instanceof GitError) {
    return { message: e.message, stderr: e.stderr };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}
