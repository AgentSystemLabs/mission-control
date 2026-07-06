import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveAgentCommandOnPath } from "../../../electron/agent-cli-resolution";
import { resolveCommandOnPath, sanitizedProcessEnv } from "../../../electron/shell-env";
import { isWindowsCommandScript } from "../../../electron/windows-cmd";
import { MC_AGENT_ENV_KEYS } from "~/shared/opencode-mission-control-plugin";

export type RunCliOptions = {
  cwd?: string;
  /** Stdin payload. If supplied, child gets a real stdin pipe instead of "ignore". */
  input?: string;
  /** Override the timeout. Defaults to 60s — long enough for headless `claude -p` calls. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

type CliSpawnInvocation = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

const CMD_SHIM_TARGET = /%(?:~dp0|dp0)%[\\/]+([^"]+\.(?:cjs|js|mjs))"/gi;

/**
 * Internal print-mode helpers (title generation, commit messages, model
 * probes, markdown refinement) run a full agent CLI headlessly. If that CLI
 * inherits a live session's Mission Control hook env — MC_TASK_ID / MC_API_URL
 * / MC_API_TOKEN — the spawned agent fires MC's own UserPromptSubmit/Stop hooks
 * back at the server, which records the helper's prompt to history and
 * recursively re-triggers title generation (a runaway `claude -p` fan-out).
 * Blank those keys so the hook commands' `[ -z "$MC_TASK_ID" ]` guard
 * short-circuits: a helper spawn must never masquerade as a real user prompt.
 */
function withoutMissionControlHookEnv(
  env: Record<string, string>,
): Record<string, string> {
  const out = { ...env };
  for (const key of MC_AGENT_ENV_KEYS) delete out[key];
  return out;
}

function resolveWindowsCmdShimInvocation(
  binary: string,
  args: string[],
  env: Record<string, string>,
): CliSpawnInvocation | null {
  let text: string;
  try {
    text = fs.readFileSync(binary, "utf8");
  } catch {
    return null;
  }

  const dir = path.dirname(binary);
  for (const match of text.matchAll(CMD_SHIM_TARGET)) {
    const rel = match[1];
    if (!rel) continue;
    const script = path.join(dir, ...rel.split(/[\\/]+/));
    if (!fs.existsSync(script)) continue;

    const bundledNode = path.join(dir, "node.exe");
    const node = fs.existsSync(bundledNode)
      ? bundledNode
      : resolveCommandOnPath("node", env, "win32");
    if (!node) return null;
    return {
      command: node,
      args: [script, ...args],
      env,
    };
  }

  return null;
}

export function buildCliSpawnInvocation(
  cmd: string,
  args: string[],
  env: Record<string, string> = sanitizedProcessEnv(),
  platform: NodeJS.Platform = os.platform(),
): CliSpawnInvocation {
  const safeEnv = withoutMissionControlHookEnv(env);
  const resolved = resolveAgentCommandOnPath(cmd, safeEnv, platform) ?? cmd;
  if (platform === "win32" && isWindowsCommandScript(resolved)) {
    const shim = resolveWindowsCmdShimInvocation(resolved, args, safeEnv);
    if (shim) return shim;
    throw new Error(`cannot safely launch Windows command shim for ${cmd}`);
  }
  return { command: resolved, args, env: safeEnv };
}

/**
 * Spawn a managed agent CLI through the same PATH resolver used by session
 * launch. That keeps print-mode helpers aligned with Windows `.cmd` shims,
 * Cursor's `agent.exe` alias, and the augmented GUI-app PATH.
 */
export function runCli(
  cmd: string,
  args: string[],
  options: RunCliOptions = {},
): Promise<string> {
  const { cwd, input, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve, reject) => {
    const invocation = buildCliSpawnInvocation(cmd, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: invocation.env,
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
