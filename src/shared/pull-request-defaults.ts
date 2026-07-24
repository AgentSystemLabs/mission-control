/**
 * Default prompt injected when Ship → Create PR opens an AI session. Prompt-
 * driven on purpose (like Ship/Sync): the agent decides the exact git/gh
 * commands — commit, push, pull + conflict resolution, `gh pr create` — rather
 * than us hard-coding a brittle script.
 */
export const DEFAULT_PULL_REQUEST_PROMPT =
  "create a pull request and open the browser when it's ready for my branch, if I have changes, just commit them and push them to remote, if there are upstream changes, pull and fix conflicts, then make the pull request";

export function normalizePullRequestPrompt(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PULL_REQUEST_PROMPT;
  const trimmed = value.trim();
  return trimmed || DEFAULT_PULL_REQUEST_PROMPT;
}
