import { TASK_AGENTS, isTaskAgent, type TaskAgent } from "./domain";

export const AI_RUNTIME_HARNESS_VALUES = TASK_AGENTS;
export type AiRuntimeHarness = TaskAgent;
export type AiModelId = string;
export type AiModelOption = {
  id: AiModelId;
  label: string;
  description?: string;
};
export type AiRuntimeModelSource = "catalog" | "cli";
export type AiRuntimeModelsResponse = {
  harness: AiRuntimeHarness;
  source: AiRuntimeModelSource;
  models: AiModelOption[];
  error?: string;
};

// Model ids are passed as single CLI argv tokens. Keep the grammar broad enough
// for provider/model ids while rejecting whitespace and shell metacharacters.
export const AI_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
export const AI_MODEL_ID_HELP =
  "Use a model id without spaces or shell characters, e.g. sonnet, gpt-5.3-codex, or anthropic/claude-sonnet-4-5.";

export const AI_RUNTIME_MODEL_OPTIONS: Record<
  AiRuntimeHarness,
  readonly AiModelOption[]
> = {
  "claude-code": [
    { id: "sonnet", label: "Sonnet", description: "Latest Sonnet coding model" },
    { id: "opus", label: "Opus", description: "Highest-capability Claude model" },
    { id: "haiku", label: "Haiku", description: "Fast, lightweight Claude model" },
    { id: "fable", label: "Fable", description: "Claude's longest-context model" },
    { id: "best", label: "Best", description: "Best available model for the account" },
    { id: "opusplan", label: "Opus Plan", description: "Opus for planning, Sonnet for execution" },
  ],
  codex: [
    { id: "gpt-5.5", label: "GPT-5.5", description: "Recommended Codex model" },
    { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced Codex model" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Faster lower-cost Codex model" },
    {
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      description: "Fast iteration model where available",
    },
  ],
  "cursor-cli": [
    { id: "auto", label: "Auto", description: "Let Cursor pick the model" },
    { id: "composer-2.5-fast", label: "Composer 2.5 Fast", description: "Cursor default" },
    { id: "composer-2.5", label: "Composer 2.5", description: "Cursor's current Composer model" },
    { id: "gpt-5.5-extra-high", label: "GPT-5.5 Extra High", description: "Deep reasoning" },
    { id: "gpt-5.3-codex", label: "Codex 5.3", description: "OpenAI coding model in Cursor" },
    {
      id: "claude-sonnet-5-thinking-high",
      label: "Sonnet 5 Thinking",
      description: "Claude Sonnet via Cursor",
    },
    {
      id: "claude-opus-4-8-thinking-high",
      label: "Opus 4.8 Thinking",
      description: "Claude Opus via Cursor",
    },
  ],
  opencode: [
    {
      id: "opencode/big-pickle",
      label: "Big Pickle",
      description: "OpenCode hosted model",
    },
    {
      id: "anthropic/claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      description: "Anthropic provider",
    },
    {
      id: "anthropic/claude-opus-4-5",
      label: "Claude Opus 4.5",
      description: "Anthropic provider",
    },
    { id: "openai/gpt-5.5", label: "GPT-5.5", description: "OpenAI provider" },
    { id: "openai/gpt-5.4", label: "GPT-5.4", description: "OpenAI provider" },
  ],
};

export function isAiRuntimeHarness(value: unknown): value is AiRuntimeHarness {
  return isTaskAgent(value);
}

export function isAiModelId(value: unknown): value is AiModelId {
  return typeof value === "string" && AI_MODEL_ID_PATTERN.test(value);
}

export function normalizeAiModelId(value: unknown): AiModelId | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isAiModelId(trimmed) ? trimmed : null;
}

export function getAiRuntimeModelOptions(
  harness: AiRuntimeHarness,
): readonly AiModelOption[] {
  return AI_RUNTIME_MODEL_OPTIONS[harness];
}

export function modelBelongsToHarnessCatalog(
  harness: AiRuntimeHarness,
  model: AiModelId | null,
): boolean {
  if (!model) return true;
  return getAiRuntimeModelOptions(harness).some((option) => option.id === model);
}

export function buildAiPrintInvocation(
  harness: AiRuntimeHarness,
  prompt: string,
  model: AiModelId | null,
): { cmd: string; args: string[] } {
  switch (harness) {
    case "claude-code":
      return {
        cmd: "claude",
        args: model ? ["-p", prompt, "--model", model] : ["-p", prompt],
      };
    case "codex":
      return {
        cmd: "codex",
        args: model ? ["exec", "--model", model, prompt] : ["exec", prompt],
      };
    case "cursor-cli":
      return {
        cmd: "cursor-agent",
        args: model
          ? ["-p", "--trust", "--mode", "ask", "--model", model, prompt]
          : ["-p", "--trust", "--mode", "ask", prompt],
      };
    case "opencode":
      return {
        cmd: "opencode",
        args: model ? ["run", "--model", model, prompt] : ["run", prompt],
      };
  }
}
