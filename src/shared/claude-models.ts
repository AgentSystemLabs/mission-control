// Client-safe list of selectable claude-code `--model` values. Lives here (no
// node imports) so both the renderer settings UI and the node-only spawn policy
// can share one source of truth. The spawn policy only accepts these values, and
// the settings selector only offers these — keep the two in lockstep here.

export const CLAUDE_MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;
export type ClaudeModelAlias = (typeof CLAUDE_MODEL_ALIASES)[number];

export const CLAUDE_MODEL_LABELS: Record<ClaudeModelAlias, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

export function isClaudeModelAlias(value: unknown): value is ClaudeModelAlias {
  return typeof value === "string" && (CLAUDE_MODEL_ALIASES as readonly string[]).includes(value);
}
