import type { TaskAgent } from "./domain";
import { AGENT_CLI_CONFIG } from "./agent-cli-config";

export type AgentRegistryEntry = {
  label: string;
  description: string;
  color: string;
  glyph: string;
  command: string;
  uiVisible: boolean;
  disabled?: boolean;
  supportsSkipPermissions: boolean;
  skipPermissionsFlag?: string;
  startCommand: (opts?: { skipPermissions?: boolean }) => string;
  titleInvocation?: (input: string) => { cmd: string; args: string[] };
};

export const AGENT_REGISTRY: Record<TaskAgent, AgentRegistryEntry> = {
  "claude-code": {
    label: "Claude Code",
    description: "Anthropic's agentic coder. Best for multi-file refactors and reasoning.",
    color: "#d6a56b",
    glyph: "◆",
    command: AGENT_CLI_CONFIG["claude-code"].command,
    uiVisible: true,
    supportsSkipPermissions: true,
    skipPermissionsFlag: "--dangerously-skip-permissions",
    startCommand: () => "claude",
    titleInvocation: (input) => ({ cmd: "claude", args: ["-p", input] }),
  },
  codex: {
    label: "Codex",
    description: "OpenAI's terminal coder. Best for test-driven, narrow tasks.",
    color: "#8ab4ff",
    glyph: "◇",
    command: AGENT_CLI_CONFIG.codex.command,
    uiVisible: true,
    supportsSkipPermissions: true,
    skipPermissionsFlag: "--yolo",
    startCommand: (opts) =>
      opts?.skipPermissions
        ? "codex --enable hooks --yolo"
        : "codex --enable hooks",
    titleInvocation: (input) => ({ cmd: "codex", args: ["exec", input] }),
  },
  "cursor-cli": {
    label: "Cursor CLI",
    description: "Cursor's terminal agent. Best for quick inline edits.",
    color: "#c792ea",
    glyph: "▲",
    command: AGENT_CLI_CONFIG["cursor-cli"].command,
    uiVisible: true,
    supportsSkipPermissions: true,
    skipPermissionsFlag: "--force",
    startCommand: (opts) => (opts?.skipPermissions ? "cursor-agent --force" : "cursor-agent"),
    titleInvocation: (input) => ({ cmd: "cursor-agent", args: ["-p", input] }),
  },
  opencode: {
    label: "OpenCode",
    description: "Open-source terminal agent. Multi-model support with a plugin ecosystem.",
    color: "#f97316",
    glyph: "◉",
    command: AGENT_CLI_CONFIG.opencode.command,
    uiVisible: true,
    supportsSkipPermissions: false,
    startCommand: () => "opencode",
    titleInvocation: (input) => ({ cmd: "opencode", args: ["run", input] }),
  },
};

export const UI_AGENTS = Object.entries(AGENT_REGISTRY)
  .filter(([, meta]) => meta.uiVisible)
  .map(([id]) => id as TaskAgent);

export const agentSupportsSkipPermissions = (agent: TaskAgent) =>
  AGENT_REGISTRY[agent].supportsSkipPermissions;
