import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ClaudeUsageLimits,
  ClaudeUsageLimitsStatus,
  ClaudeUsageWindow,
} from "~/shared/claude-usage-limits";
import { SHARED_LIMITS_FILE } from "~/shared/statusline-tap";

// Anthropic's OAuth usage endpoint — the same source Claude Code's own /usage
// screen reads. It is aggressively rate limited PER ACCOUNT, and this machine
// can host several consumers (installed app + dev instance + other tools), so
// the endpoint is a FALLBACK only. The primary source is the shared cache file
// fed by the statusline tap (src/shared/statusline-tap.ts): Claude Code pushes
// the same windows into every statusline payload for free, from rate-limit
// headers it already receives on its own API traffic.
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
// CodexBar always identifies as the Claude Code client (detected version,
// fallback claude-code/2.1.0); the endpoint may gate or shape responses on it.
const USAGE_USER_AGENT = "claude-code/2.1.0";
const REQUEST_TIMEOUT_MS = 5_000;

// How long a statusline-tap snapshot counts as fresh. While any Claude session
// is active the tap rewrites the file every few seconds; 10 minutes of silence
// means no session is reporting and the endpoint fallback may run.
const SHARED_FILE_FRESH_MS = 600_000;
// Re-stat the shared file at most this often once a snapshot is being served.
const FILE_SERVE_TTL_MS = 30_000;

const SUCCESS_TTL_MS = 180_000;
const TRANSIENT_TTL_MS = 60_000;
// Consecutive 429s back off exponentially (60s, 2m, 4m … capped at 30m). A 429
// with `retry-after: 0` used to retry every 60s, which kept the account's
// quota permanently exhausted — the retry loop was sustaining the throttle.
const RATE_LIMIT_BASE_MS = 60_000;
const RATE_LIMIT_MAX_MS = 1_800_000;

// macOS stores the Claude login in the Keychain under this service; Linux keeps
// it in ~/.claude/.credentials.json. This mirrors how the app already reads the
// same credential for sandboxes (electron/sandbox-manager.ts).
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const MAX_CRED_BYTES = 1_000_000;

type CacheEntry = { value: ClaudeUsageLimits; expiresAt: number };
let cache: CacheEntry | null = null;
let inflight: Promise<ClaudeUsageLimits> | null = null;
let consecutiveRateLimits = 0;
let sharedLimitsFile = SHARED_LIMITS_FILE;

// Indirection so tests can inject a token without touching the Keychain / fs.
let tokenReader: () => string | null = readClaudeOAuthToken;

const EMPTY_WINDOWS = { session: null, weekly: null, weeklyOpus: null };

/**
 * Read the Claude OAuth access token: ~/.claude/.credentials.json first, then
 * the macOS Keychain (service "Claude Code-credentials"). CodexBar tries the
 * file before the keychain; both hold the same credential. Returns null when
 * the user isn't logged into Claude Code. Deliberate deviation from CodexBar:
 * no token refresh here — the statusline tap is the primary source and Claude
 * Code keeps the file fresh.
 */
export function readClaudeOAuthToken(): string | null {
  const raw = readCredentialsFile() ?? readKeychainSecret(KEYCHAIN_SERVICE);
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

/**
 * Read the shared cache file (statusline tap / a sibling instance's endpoint
 * success). Returns null when missing, stale, or windowless. `fetchedAt` is
 * the file's mtime so callers can compare freshness against other snapshots.
 */
function readSharedLimitsSnapshot(now: number): ClaudeUsageLimits | null {
  try {
    const st = fs.statSync(sharedLimitsFile);
    if (!st.isFile()) return null;
    const age = now - st.mtimeMs;
    // Tolerate slight clock skew (a just-written file's mtime can land a hair
    // ahead of Date.now()); reject only genuinely-future or stale files.
    if (age > SHARED_FILE_FRESH_MS || age < -60_000) return null;
    const b = JSON.parse(fs.readFileSync(sharedLimitsFile, "utf8")) as Record<string, unknown>;
    const session = parseWindow(b?.five_hour);
    const weekly = parseWindow(b?.seven_day);
    if (!session && !weekly) return null;
    return {
      session,
      weekly,
      weeklyOpus: parseWindow(b?.seven_day_opus),
      status: "ok",
      fetchedAt: st.mtimeMs,
    };
  } catch {
    return null;
  }
}

function toApiWindow(w: ClaudeUsageWindow | null): { utilization: number; resets_at: string | null } | null {
  return w ? { utilization: w.utilization, resets_at: w.resetsAt } : null;
}

/** Publish an endpoint success to the shared file so other consumers skip it. */
function writeSharedLimitsSnapshot(value: ClaudeUsageLimits): void {
  try {
    fs.mkdirSync(path.dirname(sharedLimitsFile), { recursive: true });
    const body = JSON.stringify({
      five_hour: toApiWindow(value.session),
      seven_day: toApiWindow(value.weekly),
      seven_day_opus: toApiWindow(value.weeklyOpus),
      source: "endpoint",
      written_at: new Date(value.fetchedAt).toISOString(),
    });
    const tmp = `${sharedLimitsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, sharedLimitsFile);
  } catch {
    // best-effort — the in-memory cache still serves this instance.
  }
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
    consecutiveRateLimits = 0;
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
        Accept: "application/json",
        "User-Agent": USAGE_USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (err) {
    consecutiveRateLimits = 0;
    return {
      value: snapshot("error", EMPTY_WINDOWS, err instanceof Error ? err.message : "request failed"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    consecutiveRateLimits += 1;
    const backoffMs = Math.min(
      RATE_LIMIT_MAX_MS,
      RATE_LIMIT_BASE_MS * 2 ** (consecutiveRateLimits - 1),
    );
    const retryMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const ttlMs = Math.min(RATE_LIMIT_MAX_MS, Math.max(backoffMs, retryMs ?? 0));
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
  consecutiveRateLimits = 0;
  // 401 = logged out. 403 is a scope/permission problem (e.g. token missing
  // `user:profile`) — CodexBar surfaces it as a server error, not logged-out.
  if (res.status === 401) {
    return {
      value: snapshot("unauthenticated", EMPTY_WINDOWS, `auth failed (${res.status})`),
      ttlMs: TRANSIENT_TTL_MS,
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
  // Model-scoped weekly window: CodexBar prefers seven_day_sonnet over
  // seven_day_opus (newer sonnet-scoped plans reuse the same slot).
  return {
    value: snapshot("ok", {
      session: parseWindow(b?.five_hour),
      weekly: parseWindow(b?.seven_day),
      weeklyOpus: parseWindow(b?.seven_day_sonnet) ?? parseWindow(b?.seven_day_opus),
    }),
    ttlMs: SUCCESS_TTL_MS,
  };
}

/**
 * Cached, single-flight fetch of the Claude usage limits. Never throws.
 *
 * Source order: the shared statusline-tap file wins whenever it is fresh and
 * at least as new as what we're holding — including during a rate-limit
 * backoff, so the indicator recovers the moment any Claude session reports.
 * The OAuth endpoint only runs when no session has reported recently, and its
 * successes are published back to the shared file. On a transient failure
 * (rate limit / network) it keeps serving the last good snapshot so the top
 * bar doesn't flip back to a status chip once it has data.
 */
export function getClaudeUsageLimits(): Promise<ClaudeUsageLimits> {
  const now = Date.now();
  const fromFile = readSharedLimitsSnapshot(now);
  // A fresh statusline tap must win over a rate-limited endpoint snapshot even
  // when its mtime is a few ms behind the 429 response timestamp.
  if (
    fromFile &&
    (!cache || fromFile.fetchedAt >= cache.value.fetchedAt || cache.value.status === "rate_limited")
  ) {
    cache = { value: fromFile, expiresAt: now + FILE_SERVE_TTL_MS };
    return Promise.resolve(fromFile);
  }
  if (cache && cache.expiresAt > now) return Promise.resolve(cache.value);
  if (inflight) return inflight;

  const p = fetchFromApi()
    .then(({ value, ttlMs }) => {
      if (value.status === "ok") writeSharedLimitsSnapshot(value);
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

/** Test seam: clear the cache + in-flight singleton + backoff between tests. */
export function _resetClaudeUsageLimitsCache(): void {
  cache = null;
  inflight = null;
  consecutiveRateLimits = 0;
}

/** Test seam: override the token reader (pass null to restore the real one). */
export function _setTokenReaderForTests(fn: (() => string | null) | null): void {
  tokenReader = fn ?? readClaudeOAuthToken;
}

/** Test seam: point the shared cache file elsewhere (pass null to restore). */
export function _setSharedLimitsFileForTests(p: string | null): void {
  sharedLimitsFile = p ?? SHARED_LIMITS_FILE;
}
