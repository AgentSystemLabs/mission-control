/**
 * Cursor usage adapter — app local auth (state.vscdb / cursor-agent auth.json)
 * → cursor.com/api/usage-summary. Works on Windows + macOS without browser cookies.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { ProviderUsageSnapshot } from "~/shared/provider-usage";
import { emptyProviderSnapshot } from "~/shared/provider-usage";
import { normalizeCursorUsagePayload } from "~/shared/provider-usage-normalize";

const USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const REQUEST_TIMEOUT_MS = 8_000;
const SUCCESS_TTL_MS = 180_000;
const TRANSIENT_TTL_MS = 60_000;
const MAX_AUTH_BYTES = 1_000_000;

type CursorSession = { accessToken: string; cookieHeader: string };

type CacheEntry = { value: ProviderUsageSnapshot; expiresAt: number };
let cache: CacheEntry | null = null;
let inflight: Promise<ProviderUsageSnapshot> | null = null;
let sessionReader: () => CursorSession | null = readCursorAppSession;

function cursorStateDbPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    paths.push(path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"));
  } else if (process.platform === "darwin") {
    paths.push(
      path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
    );
  } else {
    const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
    paths.push(path.join(xdg, "Cursor", "User", "globalStorage", "state.vscdb"));
  }
  return paths;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function userIdFromAccessToken(accessToken: string): string | null {
  const json = decodeJwtPayload(accessToken);
  if (!json) return null;
  const sub = typeof json.sub === "string" ? json.sub : null;
  if (!sub) return null;
  const segments = sub.split("|").filter(Boolean);
  const userID = segments[segments.length - 1] ?? null;
  if (!userID || !/^[A-Za-z0-9._-]+$/.test(userID)) return null;
  return userID;
}

function readAccessTokenFromVscdb(dbPath: string): string | null {
  try {
    if (!fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 250 });
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1")
        .get("cursorAuth/accessToken") as { value?: unknown } | undefined;
      if (!row) return null;
      if (typeof row.value === "string" && row.value.trim()) return row.value.trim();
      if (Buffer.isBuffer(row.value)) {
        const s = row.value.toString("utf8").trim();
        return s || null;
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function readCursorAgentAuthFile(): string | null {
  const candidates = [
    path.join(os.homedir(), ".config", "cursor-agent", "auth.json"),
    path.join(os.homedir(), ".cursor", "auth.json"),
  ];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    candidates.unshift(path.join(appData, "cursor-agent", "auth.json"));
  }
  for (const full of candidates) {
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile() || st.size > MAX_AUTH_BYTES) continue;
      const json = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
      const token =
        (typeof json.accessToken === "string" && json.accessToken) ||
        (typeof json.access_token === "string" && json.access_token) ||
        null;
      if (token?.trim()) return token.trim();
    } catch {
      /* try next */
    }
  }
  return null;
}

function tokenIsUsable(accessToken: string): boolean {
  // CursorAppAuthSession.isUsable: skip app tokens expiring within 60s so an
  // expired local session degrades to unauthenticated instead of a 401 loop.
  const payload = decodeJwtPayload(accessToken);
  const exp = payload && typeof payload.exp === "number" ? payload.exp : null;
  if (exp === null) return true;
  return exp * 1000 > Date.now() + 60_000;
}

export function readCursorAppSession(): CursorSession | null {
  let accessToken: string | null = null;
  for (const dbPath of cursorStateDbPaths()) {
    accessToken = readAccessTokenFromVscdb(dbPath);
    if (accessToken) break;
  }
  // Port-only extension beyond CodexBar: cursor-agent CLI auth files.
  if (!accessToken) accessToken = readCursorAgentAuthFile();
  if (!accessToken) return null;
  if (!tokenIsUsable(accessToken)) return null;

  const userID = userIdFromAccessToken(accessToken);
  if (!userID) return null;

  // WorkosCursorSessionToken = userID%3A%3AaccessToken (CodexBar CursorAppAuthSession)
  const cookieHeader = `WorkosCursorSessionToken=${userID}%3A%3A${accessToken}`;
  return { accessToken, cookieHeader };
}

async function fetchCursorUsage(): Promise<{ value: ProviderUsageSnapshot; ttlMs: number }> {
  const session = sessionReader();
  if (!session) {
    return {
      value: emptyProviderSnapshot(
        "cursor",
        "unauthenticated",
        "no Cursor app session (state.vscdb / cursor-agent auth)",
      ),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(USAGE_SUMMARY_URL, {
      method: "GET",
      headers: {
        Cookie: session.cookieHeader,
        Accept: "application/json",
        "User-Agent": "MissionControl",
      },
      signal: controller.signal,
    });
  } catch (err) {
    return {
      value: emptyProviderSnapshot(
        "cursor",
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
      value: emptyProviderSnapshot("cursor", "rate_limited", "HTTP 429 from Cursor usage API"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      value: emptyProviderSnapshot("cursor", "unauthenticated", `auth failed (${res.status})`),
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
        "cursor",
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
      value: emptyProviderSnapshot("cursor", "error", "invalid JSON response"),
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  return { value: normalizeCursorUsagePayload(body), ttlMs: SUCCESS_TTL_MS };
}

/** Cached single-flight Cursor usage. Never throws. */
export function getCursorUsage(): Promise<ProviderUsageSnapshot> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return Promise.resolve(cache.value);
  if (inflight) return inflight;

  const p = fetchCursorUsage()
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

export function _resetCursorUsageCache(): void {
  cache = null;
  inflight = null;
}

export function _setCursorSessionReaderForTests(fn: (() => CursorSession | null) | null): void {
  sessionReader = fn ?? readCursorAppSession;
}
