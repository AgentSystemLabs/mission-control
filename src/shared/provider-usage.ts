/**
 * Multi-provider usage limits — CodexBar capability forked into mission-control
 * TypeScript (Windows + macOS). Catalog IDs match CodexBar's UsageProvider.
 *
 * Every catalog id has a live adapter that resolves credentials and probes
 * the provider API/local source. Missing credentials → unauthenticated.
 */

/** A single usage window (session, weekly, plan, auto, balance, …). */
export type ProviderUsageWindow = {
  /** Stable window id within the provider (e.g. session, weekly, plan). */
  id: string;
  /** Short UI label. */
  label: string;
  /**
   * Percent of the limit consumed, 0–100 (may exceed 100 from APIs).
   * `null` for meterless windows (e.g. prepaid balances) — the UI renders
   * `detail` instead of a bar; never fabricate 0% for unknown usage.
   */
  utilization: number | null;
  /** ISO-8601 reset time, or null if unknown. */
  resetsAt: string | null;
  /** Human value for meterless windows ("$12.34", "1,200 pts"). */
  detail?: string;
};

export type ProviderUsageStatus =
  | "ok"
  | "unauthenticated"
  | "rate_limited"
  | "error"
  | "unavailable";

/** CodexBar UsageProvider raw values (full catalog). */
export const PROVIDER_USAGE_IDS = [
  "codex",
  "openai",
  "azureopenai",
  "claude",
  "cursor",
  "opencode",
  "opencodego",
  "alibaba",
  "alibabatokenplan",
  "factory",
  "gemini",
  "antigravity",
  "copilot",
  "devin",
  "zai",
  "minimax",
  "manus",
  "kimi",
  "kilo",
  "kiro",
  "vertexai",
  "augment",
  "jetbrains",
  "kimik2",
  "moonshot",
  "amp",
  "t3chat",
  "ollama",
  "synthetic",
  "warp",
  "openrouter",
  "elevenlabs",
  "windsurf",
  "zed",
  "perplexity",
  "mimo",
  "doubao",
  "sakana",
  "abacus",
  "mistral",
  "deepseek",
  "codebuff",
  "crof",
  "venice",
  "commandcode",
  "qoder",
  "stepfun",
  "bedrock",
  "grok",
  "groq",
  "llmproxy",
  "litellm",
  "deepgram",
  "poe",
  "chutes",
  "crossmodel",
  "clawrouter",
  "wayfinder",
] as const;

export type ProviderUsageId = (typeof PROVIDER_USAGE_IDS)[number];

export type ProviderUsageMeta = {
  id: ProviderUsageId;
  displayName: string;
  /** Whether this provider has a live TS adapter (vs catalog-only stub). */
  implemented: boolean;
  /** Default-on for mission-control agent surface. */
  defaultEnabled: boolean;
};

/** Full forked catalog — display names align with CodexBar ProviderDefaults. */
export const PROVIDER_USAGE_CATALOG: readonly ProviderUsageMeta[] = [
  { id: "claude", displayName: "Claude", implemented: true, defaultEnabled: true },
  { id: "codex", displayName: "Codex", implemented: true, defaultEnabled: true },
  { id: "cursor", displayName: "Cursor", implemented: true, defaultEnabled: true },
  { id: "openai", displayName: "OpenAI", implemented: true, defaultEnabled: false },
  { id: "azureopenai", displayName: "Azure OpenAI", implemented: true, defaultEnabled: false },
  { id: "opencode", displayName: "OpenCode", implemented: true, defaultEnabled: false },
  { id: "opencodego", displayName: "OpenCode Go", implemented: true, defaultEnabled: false },
  { id: "alibaba", displayName: "Alibaba Coding Plan", implemented: true, defaultEnabled: false },
  { id: "alibabatokenplan", displayName: "Alibaba Token Plan", implemented: true, defaultEnabled: false },
  { id: "factory", displayName: "Factory", implemented: true, defaultEnabled: false },
  { id: "gemini", displayName: "Gemini", implemented: true, defaultEnabled: false },
  { id: "antigravity", displayName: "Antigravity", implemented: true, defaultEnabled: false },
  { id: "copilot", displayName: "Copilot", implemented: true, defaultEnabled: false },
  { id: "devin", displayName: "Devin", implemented: true, defaultEnabled: false },
  { id: "zai", displayName: "Z.ai", implemented: true, defaultEnabled: false },
  { id: "minimax", displayName: "MiniMax", implemented: true, defaultEnabled: false },
  { id: "manus", displayName: "Manus", implemented: true, defaultEnabled: false },
  { id: "kimi", displayName: "Kimi", implemented: true, defaultEnabled: false },
  { id: "kilo", displayName: "Kilo", implemented: true, defaultEnabled: false },
  { id: "kiro", displayName: "Kiro", implemented: true, defaultEnabled: false },
  { id: "vertexai", displayName: "Vertex AI", implemented: true, defaultEnabled: false },
  { id: "augment", displayName: "Augment", implemented: true, defaultEnabled: false },
  { id: "jetbrains", displayName: "JetBrains", implemented: true, defaultEnabled: false },
  { id: "kimik2", displayName: "Kimi K2", implemented: true, defaultEnabled: false },
  { id: "moonshot", displayName: "Moonshot", implemented: true, defaultEnabled: false },
  { id: "amp", displayName: "Amp", implemented: true, defaultEnabled: false },
  { id: "t3chat", displayName: "T3 Chat", implemented: true, defaultEnabled: false },
  { id: "ollama", displayName: "Ollama", implemented: true, defaultEnabled: false },
  { id: "synthetic", displayName: "Synthetic", implemented: true, defaultEnabled: false },
  { id: "warp", displayName: "Warp", implemented: true, defaultEnabled: false },
  { id: "openrouter", displayName: "OpenRouter", implemented: true, defaultEnabled: false },
  { id: "elevenlabs", displayName: "ElevenLabs", implemented: true, defaultEnabled: false },
  { id: "windsurf", displayName: "Windsurf", implemented: true, defaultEnabled: false },
  { id: "zed", displayName: "Zed", implemented: true, defaultEnabled: false },
  { id: "perplexity", displayName: "Perplexity", implemented: true, defaultEnabled: false },
  { id: "mimo", displayName: "MiMo", implemented: true, defaultEnabled: false },
  { id: "doubao", displayName: "Doubao", implemented: true, defaultEnabled: false },
  { id: "sakana", displayName: "Sakana", implemented: true, defaultEnabled: false },
  { id: "abacus", displayName: "Abacus", implemented: true, defaultEnabled: false },
  { id: "mistral", displayName: "Mistral", implemented: true, defaultEnabled: false },
  { id: "deepseek", displayName: "DeepSeek", implemented: true, defaultEnabled: false },
  { id: "codebuff", displayName: "Codebuff", implemented: true, defaultEnabled: false },
  { id: "crof", displayName: "Crof", implemented: true, defaultEnabled: false },
  { id: "venice", displayName: "Venice", implemented: true, defaultEnabled: false },
  { id: "commandcode", displayName: "Command Code", implemented: true, defaultEnabled: false },
  { id: "qoder", displayName: "Qoder", implemented: true, defaultEnabled: false },
  { id: "stepfun", displayName: "StepFun", implemented: true, defaultEnabled: false },
  { id: "bedrock", displayName: "Bedrock", implemented: true, defaultEnabled: false },
  { id: "grok", displayName: "Grok", implemented: true, defaultEnabled: false },
  { id: "groq", displayName: "Groq", implemented: true, defaultEnabled: false },
  { id: "llmproxy", displayName: "LLM Proxy", implemented: true, defaultEnabled: false },
  { id: "litellm", displayName: "LiteLLM", implemented: true, defaultEnabled: false },
  { id: "deepgram", displayName: "Deepgram", implemented: true, defaultEnabled: false },
  { id: "poe", displayName: "Poe", implemented: true, defaultEnabled: false },
  { id: "chutes", displayName: "Chutes", implemented: true, defaultEnabled: false },
  { id: "crossmodel", displayName: "CrossModel", implemented: true, defaultEnabled: false },
  { id: "clawrouter", displayName: "ClawRouter", implemented: true, defaultEnabled: false },
  { id: "wayfinder", displayName: "Wayfinder", implemented: true, defaultEnabled: false },
] as const;

export const DEFAULT_PROVIDER_USAGE_IDS: ProviderUsageId[] = PROVIDER_USAGE_CATALOG.filter(
  (p) => p.defaultEnabled,
).map((p) => p.id);

export type ProviderUsageSnapshot = {
  id: ProviderUsageId;
  displayName: string;
  status: ProviderUsageStatus;
  windows: ProviderUsageWindow[];
  fetchedAt: number;
  error?: string;
};

/** Aggregated multi-provider payload returned by GET /api/provider-usage. */
export type ProviderUsageResponse = {
  providers: ProviderUsageSnapshot[];
  fetchedAt: number;
};

export function isProviderUsageId(value: unknown): value is ProviderUsageId {
  return typeof value === "string" && (PROVIDER_USAGE_IDS as readonly string[]).includes(value);
}

export function providerDisplayName(id: ProviderUsageId): string {
  return PROVIDER_USAGE_CATALOG.find((p) => p.id === id)?.displayName ?? id;
}

export function normalizeProviderUsageIds(raw: unknown): ProviderUsageId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PROVIDER_USAGE_IDS];
  const out: ProviderUsageId[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isProviderUsageId(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out.length > 0 ? out : [...DEFAULT_PROVIDER_USAGE_IDS];
}

export function emptyProviderSnapshot(
  id: ProviderUsageId,
  status: ProviderUsageStatus,
  error?: string,
): ProviderUsageSnapshot {
  return {
    id,
    displayName: providerDisplayName(id),
    status,
    windows: [],
    fetchedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}
