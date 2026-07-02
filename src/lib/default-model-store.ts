// Module-level cache of the user's default agent/model, kept in sync by
// the settings query (mirrors the setApiToken pattern in api.ts). commandForTask
// reads it to append `--model` to every new matching agent session, so the choice
// in Settings → Defaults applies consistently to warm-pooled and cold spawns
// alike without prop-drilling settings through the terminal store.

import {
  isAiRuntimeHarness,
  normalizeAiModelId,
  type AiModelId,
  type AiRuntimeHarness,
} from "~/shared/ai-runtime-defaults";

let defaultAgent: AiRuntimeHarness = "claude-code";
let defaultModel: AiModelId | null = null;

export function setDefaultAgent(agent: AiRuntimeHarness): void {
  defaultAgent = agent;
}

export function setDefaultModel(model: AiModelId | null): void {
  defaultModel = model;
}

export function syncDefaultRuntimeDefaults(settings: {
  defaultAgent?: unknown;
  defaultModel?: unknown;
}): void {
  defaultAgent = isAiRuntimeHarness(settings.defaultAgent)
    ? settings.defaultAgent
    : "claude-code";
  defaultModel = normalizeAiModelId(settings.defaultModel);
}

export function getDefaultModelForAgent(agent: AiRuntimeHarness): AiModelId | null {
  return agent === defaultAgent ? defaultModel : null;
}
