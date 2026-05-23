import { TASK_AGENTS, type TaskAgent } from "./domain";

export type AgentCliVersionScheme = "semver" | "calendar-date";

export type AgentCliUpdateCommands =
  | readonly string[]
  | {
      default: readonly string[];
      win32?: readonly string[];
      darwin?: readonly string[];
      linux?: readonly string[];
    };

export type AgentCliPathSuffixes =
  | readonly string[]
  | {
      default?: readonly string[];
      win32?: readonly string[];
      darwin?: readonly string[];
      linux?: readonly string[];
    };

/** Single source of truth for managed agent CLI binaries, versions, and install guidance. */
export type AgentCliConfig = {
  agent: TaskAgent;
  /** Canonical command token used in spawn strings and allow-list validation. */
  command: string;
  /** PATH lookup order; first existing match wins. Defaults to [command]. */
  resolveAs?: readonly string[];
  label: string;
  versionScheme: AgentCliVersionScheme;
  minimumVersion: string;
  packageUrl: string;
  updateCommands: AgentCliUpdateCommands;
  /** Extra directories under the user home dir to prepend on PATH when they exist. */
  homePathSuffixes?: AgentCliPathSuffixes;
};

export const MANAGED_AGENTS = TASK_AGENTS;

function withResolveAs(config: Omit<AgentCliConfig, "resolveAs"> & { resolveAs?: readonly string[] }): AgentCliConfig {
  return {
    ...config,
    resolveAs: config.resolveAs ?? [config.command],
  };
}

export const AGENT_CLI_CONFIG = {
  "claude-code": withResolveAs({
    agent: "claude-code",
    command: "claude",
    label: "Claude Code",
    versionScheme: "semver",
    minimumVersion: "2.1.146",
    packageUrl: "https://docs.anthropic.com/en/docs/claude-code/setup",
    updateCommands: ["npm install -g @anthropic-ai/claude-code@latest"],
  }),
  codex: withResolveAs({
    agent: "codex",
    command: "codex",
    label: "Codex",
    versionScheme: "semver",
    minimumVersion: "0.132.0",
    packageUrl: "https://www.npmjs.com/package/@openai/codex",
    updateCommands: {
      default: ["npm install -g @openai/codex@latest"],
      darwin: ["npm install -g @openai/codex@latest", "brew upgrade codex"],
    },
  }),
  "cursor-cli": withResolveAs({
    agent: "cursor-cli",
    command: "cursor-agent",
    resolveAs: ["cursor-agent", "agent"],
    label: "Cursor CLI",
    versionScheme: "calendar-date",
    minimumVersion: "2026.05.20",
    packageUrl: "https://cursor.com/docs/cli/installation",
    updateCommands: {
      default: ["curl https://cursor.com/install -fsS | bash", "agent update"],
      win32: ["irm 'https://cursor.com/install?win32=true' | iex", "agent update"],
    },
  }),
  opencode: withResolveAs({
    agent: "opencode",
    command: "opencode",
    label: "OpenCode",
    versionScheme: "semver",
    minimumVersion: "1.0.0",
    packageUrl: "https://opencode.ai/docs/cli/",
    updateCommands: {
      default: ["curl -fsSL https://opencode.ai/install | bash", "opencode upgrade"],
      win32: ["npm i -g opencode-ai@latest", "opencode upgrade"],
      darwin: [
        "curl -fsSL https://opencode.ai/install | bash",
        "npm i -g opencode-ai@latest",
        "opencode upgrade",
      ],
    },
    homePathSuffixes: [".opencode/bin"],
  }),
} as const satisfies Record<TaskAgent, AgentCliConfig>;

export type ManagedAgent = TaskAgent;
export type AgentCliVersionRequirement = AgentCliConfig;

export const AGENT_CLI_CONFIG_BY_COMMAND = Object.fromEntries(
  Object.values(AGENT_CLI_CONFIG).map((config) => [config.command, config]),
) as Readonly<Record<string, AgentCliConfig | undefined>>;

/** @deprecated Use AGENT_CLI_CONFIG */
export const AGENT_CLI_VERSION_REQUIREMENTS = AGENT_CLI_CONFIG;

/** @deprecated Use AGENT_CLI_CONFIG_BY_COMMAND */
export const AGENT_CLI_VERSION_REQUIREMENTS_BY_COMMAND = AGENT_CLI_CONFIG_BY_COMMAND;

function isStructuredUpdateCommands(
  updateCommands: AgentCliUpdateCommands,
): updateCommands is Exclude<AgentCliUpdateCommands, readonly string[]> {
  return !Array.isArray(updateCommands);
}

function isStructuredPathSuffixes(
  suffixes: AgentCliPathSuffixes,
): suffixes is Exclude<AgentCliPathSuffixes, readonly string[]> {
  return !Array.isArray(suffixes);
}

function pathSuffixesForPlatform(
  suffixes: AgentCliPathSuffixes | undefined,
  platform: NodeJS.Platform,
): readonly string[] {
  if (!suffixes) return [];
  if (!isStructuredPathSuffixes(suffixes)) return suffixes;
  if (platform === "win32" && suffixes.win32) return suffixes.win32;
  if (platform === "darwin" && suffixes.darwin) return suffixes.darwin;
  if (platform === "linux" && suffixes.linux) return suffixes.linux;
  return suffixes.default ?? [];
}

export function agentCliConfigForAgent(agent: TaskAgent): AgentCliConfig {
  return AGENT_CLI_CONFIG[agent];
}

export function agentCliConfigForCommand(command: string): AgentCliConfig | undefined {
  return AGENT_CLI_CONFIG_BY_COMMAND[command];
}

export function spawnCommandForAgent(agent: TaskAgent): string {
  return AGENT_CLI_CONFIG[agent].command;
}

export function pathLookupCandidates(command: string): readonly string[] {
  const direct = agentCliConfigForCommand(command);
  if (direct) return direct.resolveAs ?? [direct.command];

  for (const config of Object.values(AGENT_CLI_CONFIG)) {
    const aliases = config.resolveAs ?? [config.command];
    if (aliases.includes(command)) return aliases;
  }

  return [command];
}

export function agentHomePathSuffixes(platform: NodeJS.Platform): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const config of Object.values(AGENT_CLI_CONFIG)) {
    for (const suffix of pathSuffixesForPlatform(config.homePathSuffixes, platform)) {
      if (!seen.has(suffix)) {
        seen.add(suffix);
        ordered.push(suffix);
      }
    }
  }
  return ordered;
}

export function resolveAgentCliUpdateCommands(
  updateCommands: AgentCliUpdateCommands,
  platform: NodeJS.Platform,
): readonly string[] {
  if (!isStructuredUpdateCommands(updateCommands)) {
    if (platform === "win32") {
      return updateCommands.filter(
        (command) => !command.startsWith("brew ") && !command.includes("| bash"),
      );
    }
    return updateCommands;
  }

  if (platform === "win32" && updateCommands.win32) return updateCommands.win32;
  if (platform === "darwin" && updateCommands.darwin) return updateCommands.darwin;
  if (platform === "linux" && updateCommands.linux) return updateCommands.linux;
  return updateCommands.default;
}

export const AGENT_SPAWN_COMMANDS = Object.fromEntries(
  MANAGED_AGENTS.map((agent) => [agent, AGENT_CLI_CONFIG[agent].command]),
) as Readonly<Record<TaskAgent, string>>;

export function assertAgentCliRegistrySync(registry: Record<TaskAgent, { command: string }>): void {
  for (const agent of MANAGED_AGENTS) {
    const config = AGENT_CLI_CONFIG[agent];
    const entry = registry[agent];
    if (!entry) {
      throw new Error(`Missing AGENT_REGISTRY entry for ${agent}`);
    }
    if (entry.command !== config.command) {
      throw new Error(
        `AGENT_REGISTRY command drift for ${agent}: registry=${entry.command}, config=${config.command}`,
      );
    }
  }
}

export function assertSpawnCommandsSync(spawnCommands: Record<TaskAgent, string>): void {
  for (const agent of MANAGED_AGENTS) {
    const expected = AGENT_SPAWN_COMMANDS[agent];
    const actual = spawnCommands[agent];
    if (actual !== expected) {
      throw new Error(
        `Spawn command drift for ${agent}: spawn=${actual}, config=${expected}`,
      );
    }
  }
}
