/**
 * The CLI tool Mission Control invokes to generate a commit message.
 * Order in COMMIT_CLI_VALUES doubles as the auto-detection priority used
 * the first time a user clicks Ship and has no preference saved.
 */
export const COMMIT_CLI_VALUES = ["claude", "codex", "cursor-agent", "opencode"] as const;
export type CommitCli = (typeof COMMIT_CLI_VALUES)[number];

export function isCommitCli(value: unknown): value is CommitCli {
  return (
    typeof value === "string" &&
    (COMMIT_CLI_VALUES as readonly string[]).includes(value)
  );
}

export const COMMIT_CLI_LABEL: Record<CommitCli, string> = {
  claude: "Claude Code",
  codex: "Codex",
  "cursor-agent": "Cursor Agent",
  opencode: "OpenCode",
};

/** Display-only blurb shown in the Defaults settings panel. */
export const COMMIT_CLI_DESCRIPTION: Record<CommitCli, string> = {
  claude: "Spawns `claude -p <prompt>` (Anthropic Claude Code CLI).",
  codex: "Spawns `codex exec <prompt>` (OpenAI Codex CLI, non-interactive).",
  "cursor-agent": "Spawns `cursor-agent -p <prompt>` (Cursor Agent CLI).",
  opencode: "Spawns `opencode run <prompt>` (OpenCode CLI, non-interactive).",
};

export type CommitCliDetection = Record<CommitCli, boolean>;
