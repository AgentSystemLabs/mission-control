import * as os from "node:os";
import {
  getAiRuntimeModelOptions,
  isAiModelId,
  type AiModelOption,
  type AiRuntimeHarness,
  type AiRuntimeModelsResponse,
} from "~/shared/ai-runtime-defaults";
import { runCli } from "./claude-cli";

const MODEL_LIST_TIMEOUT_MS = 8_000;
const MODEL_LIST_CACHE_TTL_MS = 60_000;
const cache = new Map<
  AiRuntimeHarness,
  { expiresAt: number; response: AiRuntimeModelsResponse }
>();
const inFlight = new Map<AiRuntimeHarness, Promise<AiRuntimeModelsResponse>>();

export function clearAiRuntimeModelCache(): void {
  cache.clear();
  inFlight.clear();
}

function dedupeModels(models: AiModelOption[]): AiModelOption[] {
  const seen = new Set<string>();
  const out: AiModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

export function parseCursorModelList(raw: string): AiModelOption[] {
  return dedupeModels(
    raw
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\S+)\s+-\s+(.+)$/);
        if (!match) return null;
        const [, id, label] = match;
        if (!id || !label || !isAiModelId(id)) return null;
        return { id, label: label.trim() };
      })
      .filter((model): model is AiModelOption => model !== null),
  );
}

export function parsePlainModelList(raw: string): AiModelOption[] {
  return dedupeModels(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(isAiModelId)
      .map((id) => ({ id, label: id })),
  );
}

function redactDiscoveryError(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "sk-<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{12,}/gi, "Bearer <redacted>")
    .replace(/([?&](?:token|api_key|access_token|key)=)[^&\s"']+/gi, "$1<redacted>");
}

async function liveModelOptions(
  harness: AiRuntimeHarness,
): Promise<AiModelOption[] | null> {
  switch (harness) {
    case "cursor-cli": {
      const raw = await runCli("cursor-agent", ["--list-models"], {
        cwd: os.tmpdir(),
        timeoutMs: MODEL_LIST_TIMEOUT_MS,
      });
      return parseCursorModelList(raw);
    }
    case "opencode": {
      const raw = await runCli("opencode", ["models"], {
        cwd: os.tmpdir(),
        timeoutMs: MODEL_LIST_TIMEOUT_MS,
      });
      return parsePlainModelList(raw);
    }
    case "claude-code":
    case "codex":
      return null;
  }
}

export async function listAiRuntimeModels(
  harness: AiRuntimeHarness,
): Promise<AiRuntimeModelsResponse> {
  const cached = cache.get(harness);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  const running = inFlight.get(harness);
  if (running) return running;

  const promise = loadAiRuntimeModels(harness);
  inFlight.set(harness, promise);
  try {
    const response = await promise;
    cache.set(harness, {
      expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS,
      response,
    });
    return response;
  } finally {
    inFlight.delete(harness);
  }
}

async function loadAiRuntimeModels(
  harness: AiRuntimeHarness,
): Promise<AiRuntimeModelsResponse> {
  const catalog = [...getAiRuntimeModelOptions(harness)];
  try {
    const live = await liveModelOptions(harness);
    if (live?.length) {
      return { harness, source: "cli", models: live };
    }
  } catch (error) {
    console.warn(
      `[ai-runtime-models] ${harness} discovery failed: ${
        error instanceof Error
          ? redactDiscoveryError(error.message)
          : redactDiscoveryError(String(error))
      }`,
    );
    return {
      harness,
      source: "catalog",
      models: catalog,
      error: "model discovery failed",
    };
  }
  return { harness, source: "catalog", models: catalog };
}
