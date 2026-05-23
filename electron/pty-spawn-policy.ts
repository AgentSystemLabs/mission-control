import * as fs from "node:fs";
import * as path from "node:path";
import { AGENT_SPAWN_COMMANDS } from "../src/shared/agent-cli-config";
import type { TaskAgent } from "../src/shared/domain";

export type TaskAgentSpawn = TaskAgent;

/** @deprecated Import AGENT_SPAWN_COMMANDS from agent-cli-config instead. */
export const AGENT_BINARIES = AGENT_SPAWN_COMMANDS;

export type BaseSpawnRequest = {
  taskId: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  mcEnv?: { apiUrl?: string; token?: string };
  /** Mission Control UI theme so agent skills can match diagram styling. */
  missionControlTheme?: "dark" | "light";
};

export type AgentSpawnRequest = BaseSpawnRequest & {
  agent: TaskAgentSpawn;
  dangerouslySkipPermissions?: boolean;
  shell?: never;
};

export type ShellSpawnRequest = BaseSpawnRequest & {
  // Renderer must set shell: true for a free-form user shell terminal (agent
  // undefined). Forces every spawn callsite to declare which boundary it's
  // on — agent allow-list vs. user-driven shell — so a briefly-compromised
  // renderer can't slip an arbitrary command through the "agent" branch.
  shell: true;
  agent?: never;
  dangerouslySkipPermissions?: never;
};

export type SpawnRequest = AgentSpawnRequest | ShellSpawnRequest;

export type SpawnPlan =
  | {
      mode: "agent";
      agent: TaskAgentSpawn;
      binary: string;       // resolved agent binary/shim
      argv: string[];        // already-tokenized agent arguments, no shell parsing
      spawnTarget: string;  // executable passed to node-pty
      spawnArgs: string[];  // argv passed to node-pty
      cwd: string;          // canonical (realpath'd) cwd — pass this to spawn, not the original request
    }
  | {
      mode: "shell";
      shellPath: string;     // absolute path to the user's login shell
      shellArgs: string[];   // argv passed to that shell
      command: string;       // the user-supplied shell command (may be empty)
      cwd: string;          // canonical (realpath'd) cwd — pass this to spawn, not the original request
    };

export type SpawnPolicyDeps = {
  // Real fs check by default; tests inject doubles.
  cwdExists?: (cwd: string) => boolean;
  // Resolve a cwd to its canonical absolute path. Tests inject identity.
  realpath?: (p: string) => string;
  // Snapshot of registered project roots. Already canonicalized by caller.
  projectRoots: () => string[];
  // Resolve a command name (claude/codex/cursor-agent) to an absolute path on PATH.
  resolveCommand: (name: string) => string | null;
  // Returns the user's login shell and its argv for the given command.
  resolveShell: () => { shell: string; shellArgs: (cmd: string | undefined) => string[] };
  platform?: NodeJS.Platform;
  windowsSystemRoot?: () => string | undefined;
};

export class SpawnPolicyError extends Error {
  readonly code: SpawnPolicyErrorCode;
  constructor(code: SpawnPolicyErrorCode, message: string) {
    super(message);
    this.name = "SpawnPolicyError";
    this.code = code;
  }
}

export type SpawnPolicyErrorCode =
  | "invalid-cwd"
  | "cwd-outside-project-roots"
  | "missing-agent-or-shell-flag"
  | "unknown-agent"
  | "command-not-on-allowlist"
  | "binary-not-found"
  | "shell-with-agent"
  | "shell-meta-in-args"
  | "agent-arg-not-allowed"
  | "empty-command";

const SHELL_META = /[`$();&|<>"'\\\n\r\t*?{}[\]~#!]/;
const AGENT_VALUE = /^[A-Za-z0-9._:-]+$/;

type AgentArgRule = {
  value: false | { allowed?: readonly string[] };
  requiresDangerouslySkipPermissions?: boolean;
  /** When set, string arg values must start with this prefix (OpenCode session ids). */
  valuePrefix?: string;
};

const AGENT_ARG_RULES: Readonly<Record<TaskAgentSpawn, Readonly<Record<string, AgentArgRule>>>> = {
  "claude-code": {
    "--bare": { value: false },
    "--session-id": { value: {} },
    "--resume": { value: {} },
    "--dangerously-skip-permissions": {
      value: false,
      requiresDangerouslySkipPermissions: true,
    },
  },
  codex: {
    "--enable": { value: { allowed: ["hooks"] } },
    "--yolo": { value: false, requiresDangerouslySkipPermissions: true },
  },
  "cursor-cli": {
    "--resume": { value: {} },
    "--force": { value: false, requiresDangerouslySkipPermissions: true },
  },
  opencode: {
    "--session": { value: {}, valuePrefix: "ses" },
  },
};

const WINDOWS_COMMAND_SCRIPT_EXTS = new Set([".bat", ".cmd"]);

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function windowsCmdExe(deps: SpawnPolicyDeps): string {
  const root = deps.windowsSystemRoot?.() ?? process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  return path.win32.join(root, "System32", "cmd.exe");
}

function nodePtySpawnTarget(
  binary: string,
  argv: string[],
  deps: SpawnPolicyDeps,
): { spawnTarget: string; spawnArgs: string[] } {
  const platform = deps.platform ?? process.platform;
  const ext = path.extname(binary).toLowerCase();
  if (platform === "win32" && WINDOWS_COMMAND_SCRIPT_EXTS.has(ext)) {
    const command = [quoteCmdArg(binary), ...argv.map(quoteCmdArg)].join(" ");
    return {
      spawnTarget: windowsCmdExe(deps),
      spawnArgs: ["/d", "/s", "/c", command],
    };
  }
  return { spawnTarget: binary, spawnArgs: argv };
}

function withinRoot(real: string, root: string): boolean {
  if (real === root) return true;
  return real.startsWith(root + path.sep);
}

function tokenizeAgentCommand(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

function defaultCwdExists(cwd: string): boolean {
  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) return false;
    fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const CODEX_RESUME_SUBCOMMAND = "resume";

function validateCodexArgv(
  argv: string[],
  opts: { dangerouslySkipPermissions: boolean },
): void {
  if (argv[0] === CODEX_RESUME_SUBCOMMAND) {
    const sessionId = argv[1];
    if (
      !sessionId ||
      sessionId.startsWith("-") ||
      !AGENT_VALUE.test(sessionId)
    ) {
      throw new SpawnPolicyError(
        "agent-arg-not-allowed",
        "pty:spawn rejected invalid value for codex resume session id",
      );
    }
    validateAgentArgv("codex", argv.slice(2), opts);
    return;
  }
  validateAgentArgv("codex", argv, opts);
}

function validateAgentArgv(
  agent: TaskAgentSpawn,
  argv: string[],
  opts: { dangerouslySkipPermissions: boolean },
): void {
  const rules = AGENT_ARG_RULES[agent];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const rule = rules[arg];
    if (!rule) {
      throw new SpawnPolicyError(
        "agent-arg-not-allowed",
        `pty:spawn rejected unsupported ${agent} argument`,
      );
    }
    if (rule.requiresDangerouslySkipPermissions && !opts.dangerouslySkipPermissions) {
      throw new SpawnPolicyError(
        "agent-arg-not-allowed",
        `pty:spawn rejected unsupported ${agent} argument`,
      );
    }
    if (rule.value === false) continue;

    const value = argv[i + 1];
    if (
      !value ||
      value.startsWith("-") ||
      !AGENT_VALUE.test(value) ||
      (rule.value.allowed && !rule.value.allowed.includes(value)) ||
      (rule.valuePrefix && !value.startsWith(rule.valuePrefix))
    ) {
      throw new SpawnPolicyError(
        "agent-arg-not-allowed",
        `pty:spawn rejected invalid value for ${agent} argument`,
      );
    }
    i += 1;
  }
}

export function resolveSpawnPlan(req: SpawnRequest, deps: SpawnPolicyDeps): SpawnPlan {
  const cwdExists = deps.cwdExists ?? defaultCwdExists;
  const realpath = deps.realpath ?? defaultRealpath;

  // 1. cwd must be a readable directory.
  if (!req.cwd) {
    throw new SpawnPolicyError("invalid-cwd", "cwd is required");
  }
  if (!cwdExists(req.cwd)) {
    throw new SpawnPolicyError("invalid-cwd", "cwd is not an accessible directory");
  }

  // 2. cwd must resolve into one of the registered project roots. Resolving
  //    both sides through realpath prevents symlink escapes (cwd=/tmp/link →
  //    /etc, root=/Users/me/proj).
  const realCwd = realpath(req.cwd);
  const roots = deps.projectRoots().map((r) => {
    try {
      return realpath(r);
    } catch {
      return null;
    }
  }).filter((r): r is string => !!r);

  if (!roots.some((root) => withinRoot(realCwd, root))) {
    throw new SpawnPolicyError(
      "cwd-outside-project-roots",
      "cwd is not within any registered project root",
    );
  }

  // 3. Branch: shell terminal vs. agent terminal. Exactly one must be true.
  const wantsShell = req.shell === true;
  const hasAgent = typeof req.agent === "string" && req.agent.length > 0;

  if (wantsShell && hasAgent) {
    throw new SpawnPolicyError(
      "shell-with-agent",
      "pty:spawn cannot set shell=true and agent at the same time",
    );
  }

  if (!wantsShell && !hasAgent) {
    throw new SpawnPolicyError(
      "missing-agent-or-shell-flag",
      "pty:spawn requires either a known agent or shell=true",
    );
  }

  // 4. Shell mode: the command is user-supplied and intentionally goes through
  //    the login shell. Cwd was already pinned to a project root above.
  if (wantsShell) {
    const { shell, shellArgs } = deps.resolveShell();
    const command = (req.command ?? "").trim();
    return {
      mode: "shell",
      shellPath: shell,
      shellArgs: shellArgs(command.length > 0 ? command : undefined),
      command,
      cwd: realCwd,
    };
  }

  // 5. Agent mode: agent must be in the allow-list.
  const agentKey = req.agent as TaskAgentSpawn;
  const expectedBinary = AGENT_BINARIES[agentKey];
  if (!expectedBinary) {
    throw new SpawnPolicyError(
      "unknown-agent",
      "pty:spawn agent is not in the allow-list",
    );
  }

  // 6. First token of `command` must match the agent's binary; the rest is argv.
  const tokens = tokenizeAgentCommand(req.command ?? "");
  if (tokens.length === 0) {
    throw new SpawnPolicyError(
      "empty-command",
      "pty:spawn agent requires a non-empty command",
    );
  }
  if (tokens[0] !== expectedBinary) {
    throw new SpawnPolicyError(
      "command-not-on-allowlist",
      "pty:spawn agent command is not allow-listed",
    );
  }
  const argv = [...tokens.slice(1), ...(req.args ?? [])];

  // 7. Reject shell metacharacters in argv. With direct argv spawn there's no
  //    shell to re-parse them, but a stray `;` or `$()` in an arg is never a
  //    legitimate agent invocation and almost certainly an injection attempt.
  for (const arg of argv) {
    if (SHELL_META.test(arg)) {
      throw new SpawnPolicyError(
        "shell-meta-in-args",
        "pty:spawn rejected shell metacharacter in arg",
      );
    }
  }

  const spawnOpts = { dangerouslySkipPermissions: req.dangerouslySkipPermissions === true };
  if (agentKey === "codex") {
    validateCodexArgv(argv, spawnOpts);
  } else {
    validateAgentArgv(agentKey, argv, spawnOpts);
  }

  const resolved = deps.resolveCommand(expectedBinary);
  if (!resolved) {
    throw new SpawnPolicyError(
      "binary-not-found",
      "pty:spawn could not find agent binary on PATH",
    );
  }

  return {
    mode: "agent",
    agent: agentKey,
    binary: resolved,
    argv,
    ...nodePtySpawnTarget(resolved, argv, deps),
    cwd: realCwd,
  };
}
