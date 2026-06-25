// Module-level cache of the user's default claude-code model, kept in sync by
// the settings query (mirrors the setApiToken pattern in api.ts). commandForTask
// reads it to append `--model` to every new claude-code session, so the choice
// in Settings → Defaults applies consistently to warm-pooled and cold spawns
// alike without prop-drilling settings through the terminal store.

import type { ClaudeModelAlias } from "~/shared/claude-models";

let defaultModel: ClaudeModelAlias | null = null;

export function setDefaultModel(model: ClaudeModelAlias | null): void {
  defaultModel = model;
}

export function getDefaultModel(): ClaudeModelAlias | null {
  return defaultModel;
}
