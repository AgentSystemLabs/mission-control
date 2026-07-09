/**
 * Cross-platform credential resolution for CodexBar-forked providers.
 * Sources: process env, ~/.codexbar/config.json, ~/.config/codexbar/config.json,
 * and common CLI auth files. Never throws.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAX_BYTES = 2_000_000;

type CodexBarProviderConfig = {
  id?: string;
  apiKey?: string;
  cookie?: string;
  cookieHeader?: string;
  enterpriseHost?: string;
  tokenAccounts?: Array<{ apiKey?: string; selected?: boolean }>;
};

type CodexBarConfig = {
  providers?: CodexBarProviderConfig[];
};

let cachedConfig: CodexBarConfig | null | undefined;

function readJsonFile(full: string): unknown | null {
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function codexBarConfigPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".config", "codexbar", "config.json"),
    path.join(home, ".codexbar", "config.json"),
  ];
}

export function loadCodexBarConfig(): CodexBarConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  for (const p of codexBarConfigPaths()) {
    const raw = readJsonFile(p);
    if (raw && typeof raw === "object") {
      cachedConfig = raw as CodexBarConfig;
      return cachedConfig;
    }
  }
  cachedConfig = null;
  return null;
}

/** Test seam. */
export function _resetCodexBarConfigCache(): void {
  cachedConfig = undefined;
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const v of values) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

export function envFirst(keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function configApiKey(providerId: string, envKeys: string[] = []): string | null {
  const fromEnv = envFirst(envKeys);
  if (fromEnv) return fromEnv;
  const cfg = loadCodexBarConfig();
  const entry = cfg?.providers?.find((p) => p.id === providerId);
  if (!entry) return null;
  if (entry.tokenAccounts?.length) {
    const selected = entry.tokenAccounts.find((a) => a.selected && a.apiKey?.trim());
    if (selected?.apiKey?.trim()) return selected.apiKey.trim();
    const first = entry.tokenAccounts.find((a) => a.apiKey?.trim());
    if (first?.apiKey?.trim()) return first.apiKey.trim();
  }
  return firstNonEmpty(entry.apiKey);
}

/**
 * Cookie-header credential. A bare token (no `=`) is wrapped as
 * `<bareCookieName>=<token>` when the caller names the provider's real session
 * cookie; with no name it is returned raw (never guess a cookie name like
 * `session=` — no audited provider uses that).
 */
export function configCookie(
  providerId: string,
  envKeys: string[] = [],
  bareCookieName?: string,
): string | null {
  const wrap = (value: string): string => {
    if (value.includes("=") || !bareCookieName) return value;
    return `${bareCookieName}=${value}`;
  };
  const fromEnv = envFirst(envKeys);
  if (fromEnv) return wrap(fromEnv);
  const cfg = loadCodexBarConfig();
  const entry = cfg?.providers?.find((p) => p.id === providerId);
  if (!entry) return null;
  const value = firstNonEmpty(entry.cookieHeader, entry.cookie);
  return value ? wrap(value) : null;
}

export function configEnterpriseHost(providerId: string, envKeys: string[] = []): string | null {
  const fromEnv = envFirst(envKeys);
  if (fromEnv) return fromEnv.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const cfg = loadCodexBarConfig();
  const entry = cfg?.providers?.find((p) => p.id === providerId);
  const h = entry?.enterpriseHost?.trim();
  if (!h) return null;
  return h.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function readTextFileHome(...segments: string[]): string | null {
  const full = path.join(os.homedir(), ...segments);
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const t = fs.readFileSync(full, "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

export function readJsonHome(...segments: string[]): Record<string, unknown> | null {
  const raw = readTextFileHome(...segments);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pick string field from object by snake/camel keys. */
export function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
