/**
 * Codex (OpenAI) usage adapter — OAuth via ~/.codex/auth.json → wham/usage.
 * Cross-platform file credentials (Windows + macOS). No Swift / Keychain required.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProviderUsageSnapshot } from "~/shared/provider-usage";
import { emptyProviderSnapshot } from "~/shared/provider-usage";
import { normalizeCodexUsagePayload } from "~/shared/provider-usage-normalize";

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const REQUEST_TIMEOUT_MS = 8_000;
const SUCCESS_TTL_MS = 180_000;
const TRANSIENT_TTL_MS = 60_000;
const MAX_AUTH_BYTES = 1_000_000;

type CodexCreds = { accessToken: string; accountId: string | null };

type CacheEntry = { value: ProviderUsageSnapshot; expiresAt: number };
let cache: CacheEntry | null = null;
let inflight: Promise<ProviderUsageSnapshot> | null = null;
let credsReader: () => CodexCreds | null = readCodexOAuthCredentials;

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
}

/**
 * Resolve the usage endpoint like CodexOAuthUsageFetcher: honor
 * `chatgpt_base_url` from ~/.codex/config.toml; bases that already point at
 * `/backend-api` use `/wham/usage`, other bases use `/api/codex/usage`.
 */
export function resolveCodexUsageUrl(): string {
  let base = DEFAULT_BASE_URL;
  try {
    const toml = fs.readFileSync(path.join(codexHome(), "config.toml"), "utf8");
    const m = toml.match(/^\s*chatgpt_base_url\s*=\s*"([^"]+)"/m);
    if (m?.[1]?.trim()) base = m[1].trim().replace(/\/+$/, "");
  } catch {
    /* no config.toml — default base */
  }
  return base.includes("/backend-api") ? `${base}/wham/usage` : `${base}/api/codex/usage`;
}

export function readCodexOAuthCredentials(): CodexCreds | null {
  const full = path.join(codexHome(), "auth.json");
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > MAX_AUTH_BYTES) return null;
    const raw = fs.readFileSync(full, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;

    if (typeof json.OPENAI_API_KEY === "string" && json.OPENAI_API_KEY.trim()) {
      return { accessToken: json.OPENAI_API_KEY.trim(), accountId: null };
    }

    const tokens =
      json.tokens && typeof json.tokens === "object"
        ? (json.tokens as Record<string, unknown>)
        : null;
    if (!tokens) return null;
    const accessToken =
      (typeof tokens.access_token === "string" && tokens.access_token) ||
      (typeof tokens.accessToken === "string" && tokens.accessToken) ||
      null;
    if (!accessToken) return null;
    const accountId =
      (typeof tokens.account_id === "string" && tokens.account_id) ||
      (typeof tokens.accountId === "string" && tokens.accountId) ||
      null;
    return { accessToken, accountId };
  } catch {
    return null;
  }
}

async function fetchCodexUsage(): Promise<{ value: ProviderUsageSnapshot; ttlMs: number }> {
  const creds = credsReader();
  if (!creds) {
    return {
      value: emptyProviderSnapshot("codex", "unauthenticated", "no Codex credentials found (~/.codex/auth.json)"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.accessToken}`,
      Accept: "application/json",
      "User-Agent": "MissionControl",
    };
    if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId;

    res = await fetch(resolveCodexUsageUrl(), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    return {
      value: emptyProviderSnapshot(
        "codex",
        "error",
        err instanceof Error ? err.message : "request failed",
      ),
      ttlMs: TRANSIENT_TTL_MS,
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    return {
      value: emptyProviderSnapshot("codex", "rate_limited", "HTTP 429 from Codex usage API"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      value: emptyProviderSnapshot("codex", "unauthenticated", `auth failed (${res.status})`),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    return {
      value: emptyProviderSnapshot(
        "codex",
        "error",
        `unexpected status ${res.status}${detail ? `: ${detail}` : ""}`,
      ),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      value: emptyProviderSnapshot("codex", "error", "invalid JSON response"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  const snapshot = normalizeCodexUsagePayload(body);
  return { value: snapshot, ttlMs: SUCCESS_TTL_MS };
}

/** Cached single-flight Codex usage. Never throws. */
export function getCodexUsage(): Promise<ProviderUsageSnapshot> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return Promise.resolve(cache.value);
  if (inflight) return inflight;

  const p = fetchCodexUsage()
    .then(({ value, ttlMs }) => {
      const lastGood = cache?.value.status === "ok" ? cache.value : null;
      const served = value.status === "ok" ? value : lastGood ?? value;
      cache = { value: served, expiresAt: Date.now() + ttlMs };
      return served;
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

export function _resetCodexUsageCache(): void {
  cache = null;
  inflight = null;
}

export function _setCodexCredsReaderForTests(fn: (() => CodexCreds | null) | null): void {
  credsReader = fn ?? readCodexOAuthCredentials;
}
