/**
 * Shared HTTP helpers for provider usage adapters.
 */

import type { ProviderUsageId, ProviderUsageSnapshot, ProviderUsageWindow } from "~/shared/provider-usage";
import { emptyProviderSnapshot, providerDisplayName } from "~/shared/provider-usage";

export const REQUEST_TIMEOUT_MS = 8_000;

export type HttpResult =
  | { ok: true; status: number; json: unknown; text: string; headers: Record<string, string> }
  | { ok: false; status: number; text: string; error: string; headers: Record<string, string> };

function headerMap(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    const headers = headerMap(res);
    if (!res.ok) {
      return { ok: false, status: res.status, text: text.slice(0, 400), error: `HTTP ${res.status}`, headers };
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: true, status: res.status, json, text, headers };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: err instanceof Error ? err.message : "request failed",
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<HttpResult> {
  // Caller headers spread last so per-provider User-Agent/Accept overrides win.
  return request(
    url,
    { method: "GET", headers: { Accept: "application/json", "User-Agent": "MissionControl", ...headers } },
    timeoutMs,
  );
}

export async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<HttpResult> {
  return request(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": "MissionControl",
        "Content-Type": "application/json",
        ...headers,
      },
      body,
    },
    timeoutMs,
  );
}

export function mapHttpFailure(
  id: ProviderUsageId,
  result: Extract<HttpResult, { ok: false }>,
): ProviderUsageSnapshot {
  if (result.status === 401 || result.status === 403) {
    return emptyProviderSnapshot(id, "unauthenticated", result.error);
  }
  if (result.status === 429) {
    return emptyProviderSnapshot(id, "rate_limited", result.error);
  }
  return emptyProviderSnapshot(id, "error", result.error + (result.text ? `: ${result.text.slice(0, 120)}` : ""));
}

export function snapshotOk(
  id: ProviderUsageId,
  windows: ProviderUsageWindow[],
  error?: string,
): ProviderUsageSnapshot {
  return {
    id,
    displayName: providerDisplayName(id),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: Date.now(),
    ...(error && windows.length === 0 ? { error } : {}),
    ...(error && windows.length > 0 ? { error } : {}),
  };
}

export function windowOf(
  id: string,
  label: string,
  utilization: number | null | undefined,
  resetsAt: string | null = null,
  detail?: string,
): ProviderUsageWindow | null {
  const util =
    utilization === null || utilization === undefined || !Number.isFinite(utilization)
      ? null
      : utilization;
  // A window needs either a real meter or a human detail value — never a
  // fabricated 0% bar for unknown usage.
  if (util === null && !detail) return null;
  return { id, label, utilization: util, resetsAt, ...(detail ? { detail } : {}) };
}

/** Meterless window carrying a human value ("$12.34") instead of a percent. */
export function detailWindow(id: string, label: string, detail: string, resetsAt: string | null = null): ProviderUsageWindow {
  return { id, label, utilization: null, resetsAt, detail };
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isoFromSecOrMs(value: unknown): string | null {
  const n = num(value);
  if (n === null) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoFromIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function percentUsed(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null;
  return (used / limit) * 100;
}

export function percentFromRemaining(remainingFraction: number | null): number | null {
  if (remainingFraction === null) return null;
  return (1 - remainingFraction) * 100;
}
