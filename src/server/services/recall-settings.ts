// Recall (project-memory) settings, persisted in the app_settings KV store.
// These control the automatic-capture pipeline and the LLM "Recall engine" that
// distills sessions and re-ranks briefs. Kept in one place so the settings
// controller (HTTP) and the engine/auto-distill services (in-process) read the
// exact same values without duplicating key names or defaults.

import {
  AI_RUNTIME_HARNESS_VALUES,
  isAiRuntimeHarness,
  normalizeAiModelId,
  type AiModelId,
  type AiRuntimeHarness,
} from "~/shared/ai-runtime-defaults";
import {
  deleteSetting,
  getBooleanSetting,
  getSetting,
  setBooleanSetting,
  setSetting,
} from "./settings";

const RECALL_ENABLED_KEY = "recall_enabled";
const AUTO_CAPTURE_ENABLED_KEY = "recall_auto_capture_enabled";
const ENGINE_ENABLED_KEY = "recall_engine_enabled";
const ENGINE_HARNESS_KEY = "recall_engine_harness";
const ENGINE_MODEL_KEY = "recall_engine_model";
const AGENT_WRITE_ENABLED_KEY = "recall_agent_write_enabled";
const INJECT_BRIEF_ENABLED_KEY = "recall_inject_brief_enabled";
const CODE_GRAPH_ENABLED_KEY = "recall_code_graph_enabled";
const PROACTIVE_RECALL_ENABLED_KEY = "recall_proactive_recall_enabled";
const LEARNED_TOAST_ENABLED_KEY = "recall_learned_toast_enabled";

// The harness fallback mirrors session creation: use the app's configured
// default agent when Recall's own harness hasn't been set explicitly.
const DEFAULT_AGENT_SETTING_KEY = "default_agent";

export interface RecallSettings {
  /**
   * Master switch for the whole Recall feature (experimental). When off, every
   * behavioral flag below reads as false regardless of its stored value, so all
   * consumers — brief injection, proactive recall, auto-capture, agent writes,
   * graph indexing, the engine — shut off without checking a second flag. The
   * stored sub-settings are preserved and come back when re-enabled.
   */
  enabled: boolean;
  /** Master switch for auto-distilling memories when a session finishes. */
  autoCaptureEnabled: boolean;
  /** Whether the LLM engine runs (distill/dedup/re-rank). Off = deterministic only. */
  recallEngineEnabled: boolean;
  /** Which CLI harness the engine shells out to in print mode. */
  recallEngineHarness: AiRuntimeHarness;
  /** Model for the engine harness; `null` = the CLI's own default. */
  recallEngineModel: AiModelId | null;
  /** Whether an agent session may POST memories to its project. */
  agentWriteEnabled: boolean;
  /** Whether a fresh session gets the Session Brief injected on start. */
  injectBriefEnabled: boolean;
  /** Whether the brief includes the code-graph "Architecture at a glance" section. */
  codeGraphEnabled: boolean;
  /** Whether each turn gets relevant memories + graph hits injected (UserPromptSubmit). */
  proactiveRecallEnabled: boolean;
  /** Whether the "Learned N memories from this session" toast fires after auto-capture. */
  learnedToastEnabled: boolean;
}

function getEngineHarness(): AiRuntimeHarness {
  const value = getSetting(ENGINE_HARNESS_KEY);
  if (isAiRuntimeHarness(value)) return value;
  // Fall back to the app's default agent, then claude-code.
  const fallback = getSetting(DEFAULT_AGENT_SETTING_KEY);
  return isAiRuntimeHarness(fallback) ? fallback : "claude-code";
}

export function readRecallSettings(): RecallSettings {
  // Recall is an experimental feature and ships off by default; users opt in
  // from Settings. The sub-flags below keep their "on" defaults so that when a
  // user flips the master switch on, the full feature set comes on with it.
  const enabled = getBooleanSetting(RECALL_ENABLED_KEY, false);
  return {
    enabled,
    autoCaptureEnabled: enabled && getBooleanSetting(AUTO_CAPTURE_ENABLED_KEY, true),
    recallEngineEnabled: enabled && getBooleanSetting(ENGINE_ENABLED_KEY, true),
    recallEngineHarness: getEngineHarness(),
    recallEngineModel: normalizeAiModelId(getSetting(ENGINE_MODEL_KEY)),
    agentWriteEnabled: enabled && getBooleanSetting(AGENT_WRITE_ENABLED_KEY, true),
    injectBriefEnabled: enabled && getBooleanSetting(INJECT_BRIEF_ENABLED_KEY, true),
    codeGraphEnabled: enabled && getBooleanSetting(CODE_GRAPH_ENABLED_KEY, true),
    proactiveRecallEnabled: enabled && getBooleanSetting(PROACTIVE_RECALL_ENABLED_KEY, true),
    learnedToastEnabled: enabled && getBooleanSetting(LEARNED_TOAST_ENABLED_KEY, true),
  };
}

export function writeRecallSettings(patch: Partial<RecallSettings>): void {
  if (patch.enabled !== undefined) {
    setBooleanSetting(RECALL_ENABLED_KEY, patch.enabled);
  }
  if (patch.autoCaptureEnabled !== undefined) {
    setBooleanSetting(AUTO_CAPTURE_ENABLED_KEY, patch.autoCaptureEnabled);
  }
  if (patch.recallEngineEnabled !== undefined) {
    setBooleanSetting(ENGINE_ENABLED_KEY, patch.recallEngineEnabled);
  }
  if (patch.recallEngineHarness !== undefined) {
    setSetting(ENGINE_HARNESS_KEY, patch.recallEngineHarness);
  }
  if (patch.recallEngineModel !== undefined) {
    if (patch.recallEngineModel === null) deleteSetting(ENGINE_MODEL_KEY);
    else setSetting(ENGINE_MODEL_KEY, patch.recallEngineModel);
  }
  if (patch.agentWriteEnabled !== undefined) {
    setBooleanSetting(AGENT_WRITE_ENABLED_KEY, patch.agentWriteEnabled);
  }
  if (patch.injectBriefEnabled !== undefined) {
    setBooleanSetting(INJECT_BRIEF_ENABLED_KEY, patch.injectBriefEnabled);
  }
  if (patch.codeGraphEnabled !== undefined) {
    setBooleanSetting(CODE_GRAPH_ENABLED_KEY, patch.codeGraphEnabled);
  }
  if (patch.proactiveRecallEnabled !== undefined) {
    setBooleanSetting(PROACTIVE_RECALL_ENABLED_KEY, patch.proactiveRecallEnabled);
  }
  if (patch.learnedToastEnabled !== undefined) {
    setBooleanSetting(LEARNED_TOAST_ENABLED_KEY, patch.learnedToastEnabled);
  }
}

export const RECALL_HARNESS_VALUES = AI_RUNTIME_HARNESS_VALUES;
