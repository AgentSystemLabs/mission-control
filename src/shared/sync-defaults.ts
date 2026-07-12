/**
 * Default prompt injected when the branch Sync split-button opens an AI session
 * to pull upstream changes into the current branch. Prompt-driven on purpose:
 * the agent decides the exact git commands (stash vs. local commit, rebase vs.
 * merge, conflict resolution) rather than us hard-coding a brittle script.
 */
export const DEFAULT_SYNC_PROMPT =
  "Sync the current branch with its upstream/remote. First fetch, then pull the latest upstream commits into this branch. If the working tree has uncommitted changes, stash them first (include untracked files); if the stash cannot be created, commit the changes locally instead so the pull can proceed. Resolve any merge or rebase conflicts. When the pull is complete and conflict-free, restore the stashed changes with `git stash pop` and resolve any conflicts that surface. Leave the working tree updated with upstream changes, and tell me what you did.";

export function normalizeSyncPrompt(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SYNC_PROMPT;
  const trimmed = value.trim();
  return trimmed || DEFAULT_SYNC_PROMPT;
}
