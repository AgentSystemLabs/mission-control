import type { TaskAgent } from "./domain";

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
    command: "claude",
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
    command: "codex",
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
    command: "cursor-agent",
    uiVisible: true,
    supportsSkipPermissions: true,
    skipPermissionsFlag: "--force",
    startCommand: (opts) => (opts?.skipPermissions ? "cursor-agent --force" : "cursor-agent"),
    titleInvocation: (input) => ({ cmd: "cursor-agent", args: ["-p", input] }),
  },
  shell: {
    label: "Shell",
    description: "Plain shell session.",
    color: "#ff5a1f",
    glyph: "❯",
    command: "$SHELL",
    uiVisible: false,
    supportsSkipPermissions: false,
    startCommand: () => "",
  },
};

export const UI_AGENTS = Object.entries(AGENT_REGISTRY)
  .filter(([, meta]) => meta.uiVisible)
  .map(([id]) => id as TaskAgent);

export const agentSupportsSkipPermissions = (agent: TaskAgent) =>
  AGENT_REGISTRY[agent].supportsSkipPermissions;
