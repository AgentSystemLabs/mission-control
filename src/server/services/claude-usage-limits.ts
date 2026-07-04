import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ClaudeUsageLimits,
  ClaudeUsageLimitsStatus,
  ClaudeUsageWindow,
} from "~/shared/claude-usage-limits";

// Anthropic's OAuth usage endpoint — the same source Claude Code's own /usage
// screen and statusline tools (e.g. ccstatusline) read. Returns the live
// utilization + reset time for each rate-limit window.
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const REQUEST_TIMEOUT_MS = 5_000;

// The endpoint is aggressively rate limited, so we cache successes for a few
// minutes and, on a 429, back off for as long as the server's Retry-After asks
// (clamped) rather than a flat window — so a transient throttle recovers fast.
const SUCCESS_TTL_MS = 180_000;
const TRANSIENT_TTL_MS = 60_000;
const RATE_LIMIT_MIN_MS = 30_000;
const RATE_LIMIT_MAX_MS = 300_000;

// macOS stores the Claude login in the Keychain under this service; Linux keeps
// it in ~/.claude/.credentials.json. This mirrors how the app already reads the
// same credential for sandboxes (electron/sandbox-manager.ts).
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const MAX_CRED_BYTES = 1_000_000;

type CacheEntry = { value: ClaudeUsageLimits; expiresAt: number };
let cache: CacheEntry | null = null;
let inflight: Promise<ClaudeUsageLimits> | null = null;

// Indirection so tests can inject a token without touching the Keychain / fs.
let tokenReader: () => string | null = readClaudeOAuthToken;

const EMPTY_WINDOWS = { session: null, weekly: null, weeklyOpus: null };

/**
 * Read the Claude OAuth access token: macOS Keychain first (service
 * "Claude Code-credentials"), then ~/.claude/.credentials.json. Returns null
 * when the user isn't logged into Claude Code. Faithful to the reader in
 * electron/sandbox-manager.ts:831-876 — both read the same item.
 */
export function readClaudeOAuthToken(): string | null {
  const raw = readKeychainSecret(KEYCHAIN_SERVICE) ?? readCredentialsFile();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown } };
    const token = parsed.claudeAiOauth?.accessToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function readKeychainSecret(service: string): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.replace(/\r?\n$/, "");
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    // Item missing or access denied — treat as logged out.
    return null;
  }
}

function readCredentialsFile(): string | null {
  const full = path.join(os.homedir(), ".claude", ".credentials.json");
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > MAX_CRED_BYTES) return null;
    const content = fs.readFileSync(full, "utf8");
    return content.length ? content : null;
  } catch {
    return null;
  }
}

function parseWindow(bucket: unknown): ClaudeUsageWindow | null {
  if (!bucket || typeof bucket !== "object") return null;
  const b = bucket as { utilization?: unknown; resets_at?: unknown };
  if (typeof b.utilization !== "number" || !Number.isFinite(b.utilization)) return null;
  return {
    utilization: b.utilization,
    resetsAt: typeof b.resets_at === "string" ? b.resets_at : null,
  };
}

function snapshot(
  status: ClaudeUsageLimitsStatus,
  windows: Pick<ClaudeUsageLimits, "session" | "weekly" | "weeklyOpus">,
  error?: string,
): ClaudeUsageLimits {
  return {
    session: windows.session,
    weekly: windows.weekly,
    weeklyOpus: windows.weeklyOpus,
    status,
    fetchedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

/** Parse an HTTP Retry-After header (seconds or HTTP-date) into ms, or null. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? seconds * 1000 : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  const ms = at - Date.now();
  return ms > 0 ? ms : null;
}

type FetchResult = { value: ClaudeUsageLimits; ttlMs: number };

async function fetchFromApi(): Promise<FetchResult> {
  const token = tokenReader();
  if (!token) {
    return {
      value: snapshot("unauthenticated", EMPTY_WINDOWS, "no Claude credentials found"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(USAGE_API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": OAUTH_BETA_HEADER,
      },
      signal: controller.signal,
    });
  } catch (err) {
    return {
      value: snapshot("error", EMPTY_WINDOWS, err instanceof Error ? err.message : "request failed"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return {
      value: snapshot("unauthenticated", EMPTY_WINDOWS, `auth failed (${res.status})`),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }
  if (res.status === 429) {
    const retryMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const ttlMs = Math.min(RATE_LIMIT_MAX_MS, Math.max(RATE_LIMIT_MIN_MS, retryMs ?? TRANSIENT_TTL_MS));
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim();
    } catch {
      /* body unreadable */
    }
    return {
      value: snapshot(
        "rate_limited",
        EMPTY_WINDOWS,
        `HTTP 429; retry in ~${Math.round(ttlMs / 1000)}s${detail ? ` — ${detail}` : ""}`,
      ),
      ttlMs,
    };
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* body already consumed or unreadable */
    }
    return {
      value: snapshot("error", EMPTY_WINDOWS, `unexpected status ${res.status}${detail ? `: ${detail}` : ""}`),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { value: snapshot("error", EMPTY_WINDOWS, "invalid JSON response"), ttlMs: TRANSIENT_TTL_MS };
  }
  const b = body as Record<string, unknown>;
  return {
    value: snapshot("ok", {
      session: parseWindow(b?.five_hour),
      weekly: parseWindow(b?.seven_day),
      weeklyOpus: parseWindow(b?.seven_day_opus),
    }),
    ttlMs: SUCCESS_TTL_MS,
  };
}

/**
 * Cached, single-flight fetch of the Claude usage limits. Never throws. On a
 * transient failure (rate limit / network) it keeps serving the last good
 * snapshot so the top bar doesn't flip back to a status chip once it has data.
 */
export function getClaudeUsageLimits(): Promise<ClaudeUsageLimits> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return Promise.resolve(cache.value);
  if (inflight) return inflight;

  const p = fetchFromApi()
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

/** Test seam: clear the cache + in-flight singleton between tests. */
export function _resetClaudeUsageLimitsCache(): void {
  cache = null;
  inflight = null;
}

/** Test seam: override the token reader (pass null to restore the real one). */
export function _setTokenReaderForTests(fn: (() => string | null) | null): void {
  tokenReader = fn ?? readClaudeOAuthToken;
}
