/**
 * One-click CLI updates for the managed agents.
 *
 * The per-platform update commands in AGENT_CLI_CONFIG are alternatives, not
 * steps — which one is safe to run depends on how the CLI was installed
 * (`npm install -g` over a brew install leaves two binaries shadowing each
 * other). The install method is sniffed from the resolved binary's real path
 * and the matching command is picked; unknown installs prefer the CLI's own
 * self-updater, which updates in place regardless of origin.
 *
 * The renderer only ever sends an agent id over IPC — the command is chosen
 * in the main process from this compiled-in config, so no shell string
 * crosses the IPC boundary.
 */

import type { TaskAgent } from "./domain";

export type AgentCliInstallMethod = "npm" | "homebrew" | "other";

export type AgentCliUpdateRun =
  | { ok: true; agent: TaskAgent; command: string; version: string | null }
  | {
      ok: false;
      agent: TaskAgent;
      command?: string;
      reason:
        | "unsupported-agent"
        | "not-installed"
        | "no-update-command"
        | "already-running"
        | "spawn-failed"
        | "timeout"
        | "failed";
      exitCode?: number | null;
      output?: string;
    };

/**
 * Classify an installed binary by its real (symlink-resolved) path. npm is
 * checked before homebrew: a brew-node global install lives at
 * /opt/homebrew/lib/node_modules/... and must count as npm-managed.
 */
export function detectAgentCliInstallMethod(realBinaryPath: string): AgentCliInstallMethod {
  const normalized = realBinaryPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/node_modules/")) return "npm";
  if (
    normalized.includes("/cellar/") ||
    normalized.includes("/homebrew/") ||
    normalized.includes("/linuxbrew/")
  ) {
    return "homebrew";
  }
  return "other";
}

const NPM_COMMAND_RE = /^(npm|pnpm|yarn|bun)\s/;
const INSTALLER_SCRIPT_RE = /^(curl|wget|irm)\b/;

/**
 * Pick the update command matching the detected install method from the
 * platform-resolved alternatives. `cliAliases` are the binary names the CLI
 * answers to (AGENT_CLI_CONFIG resolveAs), used to recognize a self-update
 * command like `opencode upgrade` or `agent update`.
 */
export function selectAgentCliUpdateCommand(
  commands: readonly string[],
  method: AgentCliInstallMethod,
  cliAliases: readonly string[],
): string | null {
  const npm = commands.find((command) => NPM_COMMAND_RE.test(command));
  const brew = commands.find((command) => command.startsWith("brew "));
  const selfUpdate = commands.find((command) => {
    const binary = command.split(/\s+/)[0];
    return !!binary && cliAliases.includes(binary);
  });
  const installerScript = commands.find((command) => INSTALLER_SCRIPT_RE.test(command));

  if (method === "npm" && npm) return npm;
  if (method === "homebrew" && brew) return brew;
  return selfUpdate ?? installerScript ?? npm ?? commands[0] ?? null;
}
