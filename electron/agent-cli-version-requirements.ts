export type ManagedAgent = "claude-code" | "codex" | "cursor-cli";

export type AgentCliVersionRequirement = {
  agent: ManagedAgent;
  command: string;
  label: string;
  versionScheme: "semver" | "calendar-date";
  minimumVersion: string;
  packageUrl: string;
  updateCommands: readonly string[];
};

export const AGENT_CLI_VERSION_REQUIREMENTS = {
  "claude-code": {
    agent: "claude-code",
    command: "claude",
    label: "Claude Code",
    versionScheme: "semver",
    minimumVersion: "2.1.146",
    packageUrl: "https://docs.anthropic.com/en/docs/claude-code/setup",
    updateCommands: ["npm install -g @anthropic-ai/claude-code@latest"],
  },
  codex: {
    agent: "codex",
    command: "codex",
    label: "Codex",
    versionScheme: "semver",
    minimumVersion: "0.132.0",
    packageUrl: "https://www.npmjs.com/package/@openai/codex",
    updateCommands: ["npm install -g @openai/codex@latest", "brew upgrade codex"],
  },
  "cursor-cli": {
    agent: "cursor-cli",
    command: "cursor-agent",
    label: "Cursor CLI",
    versionScheme: "calendar-date",
    minimumVersion: "2026.05.20",
    packageUrl: "https://cursor.com/cli",
    updateCommands: ["curl https://cursor.com/install -fsS | bash"],
  },
} as const satisfies Record<ManagedAgent, AgentCliVersionRequirement>;

export const AGENT_CLI_VERSION_REQUIREMENTS_BY_COMMAND = Object.fromEntries(
  Object.values(AGENT_CLI_VERSION_REQUIREMENTS).map((requirement) => [
    requirement.command,
    requirement,
  ]),
) as Readonly<Record<string, AgentCliVersionRequirement | undefined>>;
