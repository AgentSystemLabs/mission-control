import { spawn } from "node:child_process";

export type RunCliOptions = {
  cwd?: string;
  /** Stdin payload. If supplied, child gets a real stdin pipe instead of "ignore". */
  input?: string;
  /** Override the timeout. Defaults to 60s — long enough for headless `claude -p` calls. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

/** Single-quote a token for the user's login shell. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn a CLI through the user's login shell so PATH (nvm, asdf, brew shims)
 * resolves the same way it does in the user's terminal — see pty-manager for
 * the original rationale.
 */
export function runCli(
  cmd: string,
  args: string[],
  options: RunCliOptions = {},
): Promise<string> {
  const { cwd, input, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    // POSIX single-quote escaping is wrong for cmd.exe / PowerShell; on
    // Windows skip the login shell and spawn the binary directly with
    // argv array (no shell interpolation, no quoting needed).
    const isWindows = process.platform === "win32";
    const userShell = process.env.SHELL || "/bin/sh";
    const child = isWindows
      ? spawn(cmd, args, {
          cwd,
          env: process.env,
          stdio: [input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        })
      : spawn(userShell, ["-l", "-c", [cmd, ...args].map(shellQuote).join(" ")], {
          cwd,
          env: process.env,
          stdio: [input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("timeout"));
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `exit ${code}`));
    });
    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
  });
}
