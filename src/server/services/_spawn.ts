import { spawn } from "node:child_process";

export type SpawnCaptureResult = { stdout: string; stderr: string; code: number };

export interface SpawnCaptureOptions {
  cwd: string;
  timeoutMs: number;
  /** Error to reject with when the process runs past `timeoutMs`. */
  onTimeout: () => Error;
  /** Environment for the child; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * When set, an ENOENT spawn error (binary not on PATH) resolves with this
   * exit code instead of rejecting — lets callers treat "not installed" as a
   * normal non-zero result rather than a thrown error.
   */
  enoentCode?: number;
}

/**
 * Spawn a child process, buffer stdout/stderr as UTF-8, and resolve
 * `{ stdout, stderr, code }` when it closes. Kills the process with SIGTERM and
 * rejects with `onTimeout()` if it exceeds `timeoutMs`. Extracted from the
 * near-identical git/gh runners in `git.ts` and `worktrees.ts`.
 */
export function spawnCapture(
  command: string,
  args: string[],
  opts: SpawnCaptureOptions,
): Promise<SpawnCaptureResult> {
  const { cwd, timeoutMs, onTimeout, env, enoentCode } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(onTimeout());
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (enoentCode !== undefined && e.code === "ENOENT") {
        resolve({ stdout: "", stderr: e.message, code: enoentCode });
        return;
      }
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
