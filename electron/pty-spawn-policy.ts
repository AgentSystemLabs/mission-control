import * as fs from "node:fs";
import * as path from "node:path";

export type TaskAgentSpawn = "claude-code" | "codex" | "cursor-cli";

// Maps the renderer's task-agent slug to the binary it must exec. Adding a new
// agent here is the ONLY place a new executable can become spawn-eligible.
export const AGENT_BINARIES: Readonly<Record<TaskAgentSpawn, string>> = {
  "claude-code": "claude",
  "codex": "codex",
  "cursor-cli": "cursor-agent",
};

export type SpawnRequest = {
  taskId: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  mcEnv?: { apiUrl?: string; token?: string };
  agent?: string;
  // Renderer must set shell: true for a free-form user shell terminal (agent
  // undefined). Forces every spawn callsite to declare which boundary it's
  // on — agent allow-list vs. user-driven shell — so a briefly-compromised
  // renderer can't slip an arbitrary command through the "agent" branch.
  shell?: boolean;
};

export type SpawnPlan =
  | {
      mode: "agent";
      agent: TaskAgentSpawn;
      binary: string;       // absolute path to the agent binary
      argv: string[];        // already-tokenized arguments, no shell parsing
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
  | "empty-command";

const SHELL_META = /[`$();&|<>"'\\\n\r\t*?{}[\]~#!]/;

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

export function resolveSpawnPlan(req: SpawnRequest, deps: SpawnPolicyDeps): SpawnPlan {
  const cwdExists = deps.cwdExists ?? defaultCwdExists;
  const realpath = deps.realpath ?? defaultRealpath;

  // 1. cwd must be a readable directory.
  if (!req.cwd) {
    throw new SpawnPolicyError("invalid-cwd", "cwd is required");
  }
  if (!cwdExists(req.cwd)) {
    throw new SpawnPolicyError("invalid-cwd", `cwd is not an accessible directory: ${req.cwd}`);
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
      `cwd is not within any registered project root: ${req.cwd}`,
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
      `pty:spawn agent="${req.agent}" is not in the allow-list`,
    );
  }

  // 6. First token of `command` must match the agent's binary; the rest is argv.
  const tokens = tokenizeAgentCommand(req.command ?? "");
  if (tokens.length === 0) {
    throw new SpawnPolicyError(
      "empty-command",
      `pty:spawn agent="${agentKey}" requires a non-empty command`,
    );
  }
  if (tokens[0] !== expectedBinary) {
    throw new SpawnPolicyError(
      "command-not-on-allowlist",
      `pty:spawn agent="${agentKey}" must run "${expectedBinary}" (got "${tokens[0]}")`,
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
        `pty:spawn rejected shell metacharacter in arg: ${JSON.stringify(arg)}`,
      );
    }
  }

  // 8. Resolve the binary on PATH so the spawn target is an absolute path.
  const resolved = deps.resolveCommand(expectedBinary);
  if (!resolved) {
    throw new SpawnPolicyError(
      "binary-not-found",
      `pty:spawn could not find "${expectedBinary}" on PATH`,
    );
  }

  return { mode: "agent", agent: agentKey, binary: resolved, argv, cwd: realCwd };
}
