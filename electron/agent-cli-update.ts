import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TaskAgent } from "../src/shared/domain";
import {
  detectAgentCliInstallMethod,
  selectAgentCliUpdateCommand,
  type AgentCliUpdateRun,
} from "../src/shared/agent-cli-update";
import {
  AGENT_CLI_CONFIG,
  MANAGED_AGENTS,
  resolveAgentCliUpdateCommands,
} from "./agent-cli-version-requirements";
import { resolveAgentCommandOnPath } from "./agent-cli-resolution";
import { sanitizedProcessEnv, resolveShell } from "./shell-env";
import { checkAgentCliVersion, clearAgentCliVersionCache } from "./agent-cli-version";

// npm/brew installs routinely take minutes on cold caches; the timeout only
// guards against a truly hung installer.
const UPDATE_TIMEOUT_MS = 10 * 60_000;
const KILL_GRACE_MS = 5_000;
const OUTPUT_TAIL_LIMIT = 4_000;

function cleanShellOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim()
    .slice(-OUTPUT_TAIL_LIMIT);
}

/**
 * Update commands run through a real shell because they include pipelines
 * (`curl … | bash`). On Windows the PowerShell-flavored ones (`irm … | iex`)
 * need powershell; everything else goes through cmd.
 */
export function buildUpdateInvocation(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
): { file: string; args: string[] } {
  if (platform === "win32") {
    if (/(^|\|\s*)(irm|iex)\b/.test(command)) {
      return {
        file: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      };
    }
    const systemRoot = env.SystemRoot ?? env.WINDIR ?? "C:\\Windows";
    return {
      file: path.win32.join(systemRoot, "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", command],
    };
  }
  return { file: resolveShell(), args: ["-c", command] };
}

type ShellRunResult =
  | { ok: true; output: string }
  | { ok: false; reason: "spawn-failed" | "timeout" | "failed"; exitCode?: number | null; output: string };

function runShellCommand(command: string, env: Record<string, string>): Promise<ShellRunResult> {
  const { file, args } = buildUpdateInvocation(command, env);
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timedOut = false;
    const settle = (result: ShellRunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(file, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const append = (chunk: Buffer | string) => {
      // Keep only a tail — installer output can be huge and is only shown on failure.
      output = (output + String(chunk)).slice(-OUTPUT_TAIL_LIMIT * 2);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, UPDATE_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      settle({ ok: false, reason: "spawn-failed", output: cleanShellOutput(`${output}\n${err.message}`) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const cleaned = cleanShellOutput(output);
      if (timedOut) settle({ ok: false, reason: "timeout", exitCode: code, output: cleaned });
      else if (code === 0) settle({ ok: true, output: cleaned });
      else settle({ ok: false, reason: "failed", exitCode: code, output: cleaned });
    });
  });
}

async function executeUpdate(agent: TaskAgent): Promise<AgentCliUpdateRun> {
  const config = AGENT_CLI_CONFIG[agent];
  const env = sanitizedProcessEnv();
  const resolved = resolveAgentCommandOnPath(config.command, env);
  if (!resolved) return { ok: false, agent, reason: "not-installed" };

  let realPath = resolved;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {}
  const method = detectAgentCliInstallMethod(realPath);
  const commands = resolveAgentCliUpdateCommands(config.updateCommands, os.platform());
  const command = selectAgentCliUpdateCommand(commands, method, config.resolveAs ?? [config.command]);
  if (!command) return { ok: false, agent, reason: "no-update-command" };

  const result = await runShellCommand(command, env);
  if (!result.ok) {
    return { ok: false, agent, command, reason: result.reason, exitCode: result.exitCode, output: result.output };
  }

  // Fresh probe so pty spawns and the settings page see the new version. The
  // env is rebuilt because an installer may have created a new bin dir (e.g.
  // ~/.opencode/bin) that PATH assembly only picks up once it exists.
  clearAgentCliVersionCache();
  const freshEnv = sanitizedProcessEnv();
  const binary = resolveAgentCommandOnPath(config.command, freshEnv) ?? resolved;
  const check = checkAgentCliVersion(binary, freshEnv, config);
  return { ok: true, agent, command, version: check.version ?? null };
}

const inflightUpdates = new Map<TaskAgent, Promise<AgentCliUpdateRun>>();

/**
 * Run the update command for a managed agent CLI. Input is an untrusted
 * renderer string — it is only ever used to index the compiled-in config.
 * Single-flight per agent: a second call while one runs joins the first.
 */
export function runAgentCliUpdate(agentInput: string): Promise<AgentCliUpdateRun> {
  const agent = (MANAGED_AGENTS as readonly string[]).includes(agentInput)
    ? (agentInput as TaskAgent)
    : null;
  if (!agent) {
    return Promise.resolve({ ok: false, agent: agentInput as TaskAgent, reason: "unsupported-agent" });
  }
  const running = inflightUpdates.get(agent);
  if (running) return running;
  const run = executeUpdate(agent).finally(() => {
    inflightUpdates.delete(agent);
  });
  inflightUpdates.set(agent, run);
  return run;
}
