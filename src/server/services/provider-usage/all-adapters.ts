/**
 * Live usage adapters for every CodexBar provider id.
 * Each adapter resolves credentials (env / ~/.codexbar / local files) and attempts
 * a real probe. Missing credentials → unauthenticated (never "unavailable" for missing adapters).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProviderUsageId, ProviderUsageSnapshot, ProviderUsageWindow } from "~/shared/provider-usage";
import { emptyProviderSnapshot } from "~/shared/provider-usage";
import {
  claudeLimitsToProviderSnapshot,
  formatAmount,
  normalizeCrofUsagePayload,
  normalizeDeepSeekUsagePayload,
  normalizeElevenLabsUsagePayload,
  normalizeKimiK2UsagePayload,
  normalizeMoonshotUsagePayload,
  normalizeOpenRouterUsagePayload,
  normalizePoeUsagePayload,
} from "~/shared/provider-usage-normalize";
import { getClaudeUsageLimits } from "../claude-usage-limits";
import {
  configApiKey,
  configCookie,
  configEnterpriseHost,
  envFirst,
  pickString,
  readJsonHome,
  readTextFileHome,
} from "./credentials";
import { getCodexUsage } from "./codex-usage";
import { getCursorUsage } from "./cursor-usage";
import {
  detailWindow,
  httpGet,
  httpPost,
  isoFromIso,
  isoFromSecOrMs,
  mapHttpFailure,
  num,
  percentFromRemaining,
  percentUsed,
  snapshotOk,
  windowOf,
} from "./http";

// ── shared helpers ──────────────────────────────────────────────────────────

function unauth(id: ProviderUsageId, reason: string): ProviderUsageSnapshot {
  return emptyProviderSnapshot(id, "unauthenticated", reason);
}

function errSnap(id: ProviderUsageId, message: string): ProviderUsageSnapshot {
  return emptyProviderSnapshot(id, "error", message);
}

function balanceOnly(
  id: ProviderUsageId,
  remaining: number | null,
  unit?: string,
): ProviderUsageSnapshot {
  if (remaining === null) return errSnap(id, "no balance");
  // Prepaid balance with no meter — carry the value, never a fake 0% bar.
  return snapshotOk(id, [detailWindow("balance", "bal", formatAmount(remaining, unit))]);
}

function usedLimitWindows(
  id: ProviderUsageId,
  windows: Array<{
    id: string;
    label: string;
    used?: number | null;
    limit?: number | null;
    remaining?: number | null;
    utilization?: number | null;
    resetsAt?: string | null;
    unit?: string;
  }>,
  note?: string,
): ProviderUsageSnapshot {
  const out: ProviderUsageWindow[] = [];
  for (const w of windows) {
    let util = w.utilization ?? null;
    let detail: string | undefined;
    if (util === null) {
      if (w.used != null && w.limit != null && w.limit > 0) util = (w.used / w.limit) * 100;
      else if (w.remaining != null && w.limit != null && w.limit > 0)
        util = ((w.limit - w.remaining) / w.limit) * 100;
      // No limit → meterless: surface the known value instead of fabricating 0%.
      else if (w.remaining != null) detail = `${formatAmount(w.remaining, w.unit)} left`;
      else if (w.used != null) detail = `${formatAmount(w.used, w.unit)} used`;
    }
    const win = windowOf(w.id, w.label, util, w.resetsAt ?? null, detail);
    if (win) out.push(win);
  }
  if (out.length === 0) return errSnap(id, note ?? "no usage windows");
  return snapshotOk(id, out, note);
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

// Several dashboards are browser-gated (403 without a browser-like UA).
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Depth-first search for the first occurrence of a key anywhere in a JSON tree. */
function deepFind(value: unknown, key: string, depth = 8): unknown {
  if (depth < 0 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, key, depth - 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (key in rec && rec[key] !== undefined && rec[key] !== null) return rec[key];
  for (const v of Object.values(rec)) {
    const found = deepFind(v, key, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function pickNum(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = num(obj[k]);
    if (n !== null) return n;
  }
  return null;
}

async function bearerJson(
  id: ProviderUsageId,
  url: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: true; json: unknown } | { ok: false; snap: ProviderUsageSnapshot }> {
  const res = await httpGet(url, { Authorization: `Bearer ${token}`, ...extraHeaders });
  if (!res.ok) return { ok: false, snap: mapHttpFailure(id, res) };
  return { ok: true, json: res.json };
}

async function cookieJson(
  id: ProviderUsageId,
  url: string,
  cookie: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: true; json: unknown; text: string } | { ok: false; snap: ProviderUsageSnapshot }> {
  const res = await httpGet(url, { Cookie: cookie, ...extraHeaders });
  if (!res.ok) return { ok: false, snap: mapHttpFailure(id, res) };
  return { ok: true, json: res.json, text: res.text };
}

// ── built-in (existing) ─────────────────────────────────────────────────────

async function fetchClaude(): Promise<ProviderUsageSnapshot> {
  const limits = await getClaudeUsageLimits();
  return claudeLimitsToProviderSnapshot(limits);
}

// ── API token providers ─────────────────────────────────────────────────────

async function fetchOpenRouter(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("openrouter", ["OPENROUTER_API_KEY"]);
  if (!key) return unauth("openrouter", "missing OPENROUTER_API_KEY / config apiKey");
  const base = (envFirst(["OPENROUTER_API_URL"]) ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "HTTP-Referer": envFirst(["OPENROUTER_HTTP_REFERER"]) ?? "https://mission-control.local",
    "X-Title": envFirst(["OPENROUTER_X_TITLE"]) ?? "MissionControl",
  };
  const credits = await httpGet(`${base}/credits`, headers);
  if (!credits.ok) return mapHttpFailure("openrouter", credits);
  const keyRes = await httpGet(`${base}/key`, headers);
  return normalizeOpenRouterUsagePayload(credits.json, keyRes.ok ? keyRes.json : undefined);
}

async function fetchOpenAI(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("openai", ["OPENAI_ADMIN_KEY", "OPENAI_API_KEY"]);
  if (!key) return unauth("openai", "missing OPENAI_ADMIN_KEY / OPENAI_API_KEY");
  // Prefer org costs (admin); fall back to legacy credit grants.
  const now = Math.floor(Date.now() / 1000);
  const start = now - 7 * 86400;
  const costs = await httpGet(
    `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=1`,
    { Authorization: `Bearer ${key}` },
  );
  if (costs.ok) {
    const root = asRec(costs.json);
    const data = Array.isArray(root.data) ? root.data : [];
    let spend = 0;
    for (const row of data) {
      const r = asRec(row);
      const results = Array.isArray(r.results) ? r.results : [];
      for (const item of results) {
        const amount = asRec(asRec(item).amount);
        const v = num(amount.value);
        if (v !== null) spend += v;
      }
    }
    // Org costs have no hard limit — surface the spend value, not a fake 0%.
    return snapshotOk("openai", [detailWindow("spend7d", "7d", `$${formatAmount(spend)} spent`)]);
  }
  const grants = await httpGet("https://api.openai.com/v1/dashboard/billing/credit_grants", {
    Authorization: `Bearer ${key}`,
  });
  if (!grants.ok) return mapHttpFailure("openai", grants);
  const g = asRec(grants.json);
  const total = pickNum(g, "total_granted", "totalGranted");
  const used = pickNum(g, "total_used", "totalUsed");
  const available = pickNum(g, "total_available", "totalAvailable");
  return usedLimitWindows(
    "openai",
    [{ id: "credits", label: "credits", used, limit: total, remaining: available }],
    available !== null ? `available=${available}` : undefined,
  );
}

async function fetchAzureOpenAI(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("azureopenai", ["AZURE_OPENAI_API_KEY"]);
  const endpoint = envFirst(["AZURE_OPENAI_ENDPOINT"]) ?? configEnterpriseHost("azureopenai");
  const deployment = envFirst(["AZURE_OPENAI_DEPLOYMENT_NAME", "AZURE_OPENAI_DEPLOYMENT"]);
  if (!key || !endpoint) {
    return unauth("azureopenai", "missing AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT");
  }
  if (!deployment) return unauth("azureopenai", "missing AZURE_OPENAI_DEPLOYMENT_NAME");
  const host = endpoint.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
  const version = envFirst(["AZURE_OPENAI_API_VERSION"]) ?? "2024-02-15-preview";
  const url =
    version === "v1"
      ? `${host}/openai/v1/chat/completions`
      : `${host}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(version)}`;
  const res = await httpPost(
    url,
    { "api-key": key },
    JSON.stringify({
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      model: deployment,
    }),
  );
  if (!res.ok) return mapHttpFailure("azureopenai", res);
  // Probe-only: Azure exposes no spend/quota surface here — honest text.
  return snapshotOk("azureopenai", [detailWindow("deployment", "deploy", "reachable")]);
}

async function fetchDeepSeek(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("deepseek", ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"]);
  if (!key) return unauth("deepseek", "missing DEEPSEEK_API_KEY");
  const res = await bearerJson("deepseek", "https://api.deepseek.com/user/balance", key);
  if (!res.ok) return res.snap;
  return normalizeDeepSeekUsagePayload(res.json);
}

async function fetchMoonshot(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("moonshot", ["MOONSHOT_API_KEY", "MOONSHOT_KEY"]);
  if (!key) return unauth("moonshot", "missing MOONSHOT_API_KEY");
  const region = (envFirst(["MOONSHOT_REGION"]) ?? "international").toLowerCase();
  const host = region.includes("cn") || region.includes("china") ? "api.moonshot.cn" : "api.moonshot.ai";
  const res = await bearerJson("moonshot", `https://${host}/v1/users/me/balance`, key);
  if (!res.ok) return res.snap;
  return normalizeMoonshotUsagePayload(res.json);
}

async function fetchZai(): Promise<ProviderUsageSnapshot> {
  // ZaiUsageStats: response is data.limits[] of typed entries — `usage` is the
  // LIMIT, `currentValue` the used amount, plus remaining / percentage /
  // nextResetTime (epoch ms). Team mode (Bigmodel-* headers) is not ported.
  const key = configApiKey("zai", ["Z_AI_API_KEY"]);
  if (!key) return unauth("zai", "missing Z_AI_API_KEY");
  let quotaUrl =
    envFirst(["Z_AI_QUOTA_URL"]) ??
    `${(envFirst(["Z_AI_API_HOST"]) ?? "https://api.z.ai").replace(/\/$/, "")}/api/monitor/usage/quota/limit`;
  // Team mode: ?type=2 plus Bigmodel-Organization/Project headers.
  const org = envFirst(["Z_AI_BIGMODEL_ORGANIZATION"]);
  const project = envFirst(["Z_AI_BIGMODEL_PROJECT"]);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (org && project) {
    quotaUrl += quotaUrl.includes("?") ? "&type=2" : "?type=2";
    headers["Bigmodel-Organization"] = org;
    headers["Bigmodel-Project"] = project;
  }
  const res = await httpGet(quotaUrl, headers);
  if (!res.ok) return mapHttpFailure("zai", res);
  const root = asRec(res.json);
  const code = pickNum(root, "code");
  if (root.success === false || (code !== null && code !== 200)) {
    return errSnap("zai", `quota API returned code ${code ?? "?"}: ${pickString(root, "msg") ?? ""}`);
  }
  const data = asRec(root.data ?? root);
  const limits = Array.isArray(data.limits) ? data.limits : [];
  // Unit enum: 1=days, 3=hours, 5=minutes, 6=weeks (ZaiLimitRaw).
  const windowMinutes = (entry: Record<string, unknown>): number | null => {
    const n = pickNum(entry, "number");
    const unit = pickNum(entry, "unit");
    if (n === null || n <= 0 || unit === null) return null;
    const factor = unit === 5 ? 1 : unit === 3 ? 60 : unit === 1 ? 1440 : unit === 6 ? 10080 : null;
    return factor === null ? null : n * factor;
  };
  const windows: ProviderUsageWindow[] = [];
  for (const raw of limits) {
    const entry = asRec(raw);
    const type = String(entry.type ?? "").toUpperCase();
    const limit = pickNum(entry, "usage"); // field literally named `usage` is the limit
    const used = pickNum(entry, "currentValue", "current_value");
    const remaining = pickNum(entry, "remaining");
    const pct = pickNum(entry, "percentage", "percent");
    const util =
      limit !== null && limit > 0 && remaining !== null
        ? (Math.max(0, Math.min(limit, limit - remaining)) / limit) * 100
        : (percentUsed(used, limit) ?? pct);
    const resetsAt = isoFromSecOrMs(entry.nextResetTime ?? entry.next_reset_time);
    const minutes = windowMinutes(entry);
    const id =
      type === "TIME_LIMIT"
        ? "time"
        : minutes !== null && minutes <= 300
          ? "session"
          : "tokens";
    const label = id === "time" ? "time" : id === "session" ? "session" : "tokens";
    const win = windowOf(id, label, util, resetsAt);
    if (win && !windows.some((w) => w.id === win.id)) windows.push(win);
  }
  if (windows.length === 0) return errSnap("zai", "no limits[] entries in quota response");
  return snapshotOk("zai", windows);
}

async function fetchElevenLabs(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("elevenlabs", ["ELEVENLABS_API_KEY", "XI_API_KEY"]);
  if (!key) return unauth("elevenlabs", "missing ELEVENLABS_API_KEY / XI_API_KEY");
  const base = (envFirst(["ELEVENLABS_API_URL"]) ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const res = await httpGet(`${base}/v1/user/subscription`, { "xi-api-key": key });
  if (!res.ok) return mapHttpFailure("elevenlabs", res);
  return normalizeElevenLabsUsagePayload(res.json);
}

async function fetchPoe(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("poe", ["POE_API_KEY"]);
  if (!key) return unauth("poe", "missing POE_API_KEY");
  const res = await bearerJson("poe", "https://api.poe.com/usage/current_balance", key);
  if (!res.ok) return res.snap;
  return normalizePoeUsagePayload(res.json);
}

async function fetchCrof(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("crof", ["CROF_API_KEY", "CROFAI_API_KEY"]);
  if (!key) return unauth("crof", "missing CROF_API_KEY");
  const res = await bearerJson("crof", "https://crof.ai/usage_api/", key);
  if (!res.ok) return res.snap;
  return normalizeCrofUsagePayload(res.json);
}

async function fetchVenice(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("venice", ["VENICE_API_KEY", "VENICE_KEY"]);
  if (!key) return unauth("venice", "missing VENICE_API_KEY");
  const res = await bearerJson("venice", "https://api.venice.ai/api/v1/billing/balance", key);
  if (!res.ok) return res.snap;
  const root = asRec(res.json);
  const balances = asRec(root.balances ?? root);
  const diem = pickNum(balances, "diemBalance", "diem_balance", "DIEM");
  const usd = pickNum(balances, "usdBalance", "usd_balance", "USD");
  const allocation = pickNum(balances, "diemEpochAllocation", "diem_epoch_allocation");
  if (diem !== null && allocation !== null && allocation > 0) {
    return usedLimitWindows(
      "venice",
      [{ id: "diem", label: "diem", remaining: diem, limit: allocation }],
      `DIEM ${diem}/${allocation}`,
    );
  }
  const remaining = usd ?? diem;
  return balanceOnly("venice", remaining, remaining !== null ? `balance=${remaining}` : undefined);
}

/** Kimi usage/detail bucket: {limit, used, remaining, resetTime} — often string-typed. */
function kimiWindowFrom(
  bucket: Record<string, unknown>,
  id: string,
  label: string,
): ProviderUsageWindow | null {
  const limit = num(bucket.limit);
  const used = num(bucket.used);
  const remaining = num(bucket.remaining);
  const util =
    percentUsed(used, limit) ??
    (limit !== null && limit > 0 && remaining !== null ? ((limit - remaining) / limit) * 100 : null);
  const resetsAt = isoFromIso(bucket.resetTime ?? bucket.reset_time) ?? isoFromSecOrMs(bucket.resetTime);
  return windowOf(id, label, util, resetsAt);
}

function parseKimiUsages(body: unknown): ProviderUsageWindow[] {
  // KimiUsageSnapshot: top-level `usage` is the weekly primary; limits[]
  // entries carry a `detail` bucket (the 300-minute entry is the session).
  const root = asRec(body);
  const data = asRec(root.data ?? root);
  const windows: ProviderUsageWindow[] = [];
  const weekly = kimiWindowFrom(asRec(data.usage ?? root.usage), "weekly", "week");
  const limits = Array.isArray(data.limits) ? data.limits : Array.isArray(root.limits) ? root.limits : [];
  for (const raw of limits) {
    const lim = asRec(raw);
    const detail = asRec(lim.detail ?? lim);
    const minutes = num(lim.window_minutes ?? lim.windowMinutes ?? lim.duration ?? detail.window_minutes);
    const name = String(lim.name ?? detail.name ?? "");
    const isSession = minutes === 300 || /5.?hour|session|300/i.test(name) || limits.length === 1;
    const win = kimiWindowFrom(detail, isSession ? "session" : name || "quota", isSession ? "session" : "quota");
    if (win && !windows.some((w) => w.id === win.id)) windows.push(win);
  }
  if (weekly) windows.push(weekly);
  return windows;
}

async function fetchKimi(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("kimi", ["KIMI_CODE_API_KEY", "KIMI_API_KEY"]);
  if (key) {
    const res = await bearerJson("kimi", "https://api.kimi.com/coding/v1/usages", key);
    if (res.ok) {
      const windows = parseKimiUsages(res.json);
      if (windows.length === 0) return errSnap("kimi", "no usage/limits fields in response");
      return snapshotOk("kimi", windows);
    }
    if (res.snap.status !== "unauthenticated") return res.snap;
  }
  // Web-gateway fallback: kimi-auth token, Connect-style POST with the
  // FEATURE_CODING scope body (KimiUsageFetcher).
  const cookie = configCookie("kimi", ["KIMI_AUTH_TOKEN", "KIMI_COOKIE"], "kimi-auth");
  if (!cookie) return unauth("kimi", "missing KIMI_CODE_API_KEY / KIMI_AUTH_TOKEN");
  const token = cookie.match(/(?:^|;\s*)kimi-auth=([^;]+)/i)?.[1] ?? cookie;
  const res = await httpPost(
    "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages",
    {
      Authorization: `Bearer ${token}`,
      Cookie: cookie,
      Origin: "https://www.kimi.com",
      Referer: "https://www.kimi.com/code/console",
      "connect-protocol-version": "1",
      "x-msh-platform": "web",
      "x-language": "en-US",
      "User-Agent": CHROME_UA,
    },
    JSON.stringify({ scope: ["FEATURE_CODING"] }),
  );
  if (!res.ok) return mapHttpFailure("kimi", res);
  // Gateway shape: usages[] of {scope, detail, limits[]} — detail is the
  // weekly primary; limits[0].detail is the 5-hour session window.
  const root = asRec(res.json);
  const usages = Array.isArray(root.usages) ? root.usages : [];
  const windows: ProviderUsageWindow[] = [];
  for (const raw of usages) {
    const entry = asRec(raw);
    const scope = String(entry.scope ?? "");
    if (scope && scope !== "FEATURE_CODING") continue;
    const weekly = kimiWindowFrom(asRec(entry.detail), "weekly", "week");
    if (weekly && !windows.some((w) => w.id === "weekly")) windows.push(weekly);
    const limits = Array.isArray(entry.limits) ? entry.limits : [];
    const sessionDetail = asRec(asRec(limits[0]).detail);
    const session = kimiWindowFrom(sessionDetail, "session", "session");
    if (session && !windows.some((w) => w.id === "session")) windows.push(session);
  }
  if (windows.length === 0) {
    const parsed = parseKimiUsages(res.json);
    if (parsed.length > 0) return snapshotOk("kimi", parsed);
    return errSnap("kimi", "no usages[] entries in gateway response");
  }
  return snapshotOk("kimi", windows);
}

async function fetchKimiK2(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("kimik2", ["KIMI_K2_API_KEY", "KIMI_API_KEY", "KIMI_KEY"]);
  if (!key) return unauth("kimik2", "missing KIMI_K2_API_KEY");
  const res = await bearerJson("kimik2", "https://kimi-k2.ai/api/user/credits", key);
  if (!res.ok) return res.snap;
  return normalizeKimiK2UsagePayload(res.json);
}

async function fetchCopilot(): Promise<ProviderUsageSnapshot> {
  // CopilotUsageFetcher: GET /copilot_internal/user with the GitHub OAuth
  // token directly (no exchange) — but the endpoint expects Copilot editor
  // headers. Config token first (CodexBar's device-flow token), then env /
  // gh-cli files as port extensions. Zero-entitlement snapshots are dropped.
  const ghToken =
    envFirst(["COPILOT_API_TOKEN"]) ??
    configApiKey("copilot") ??
    envFirst(["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN"]) ??
    readTextFileHome(".config", "github-copilot", "hosts.json")?.match(/"oauth_token"\s*:\s*"([^"]+)"/)?.[1] ??
    readTextFileHome(".config", "gh", "hosts.yml")?.match(/oauth_token:\s*(\S+)/)?.[1] ??
    null;
  if (!ghToken) return unauth("copilot", "missing GitHub token (codexbar config / GITHUB_TOKEN / gh cli)");
  const host = configEnterpriseHost("copilot") ?? "api.github.com";
  const base = host.includes("://") ? host.replace(/\/$/, "") : `https://${host}`;
  const url = base.includes("api.github.com")
    ? "https://api.github.com/copilot_internal/user"
    : `${base}/copilot_internal/user`;
  const res = await httpGet(url, {
    Authorization: `token ${ghToken}`,
    Accept: "application/json",
    "Editor-Version": "vscode/1.96.2",
    "Editor-Plugin-Version": "copilot-chat/0.26.7",
    "User-Agent": "GitHubCopilotChat/0.26.7",
    "X-Github-Api-Version": "2025-04-01",
  });
  if (!res.ok) return mapHttpFailure("copilot", res);
  const root = asRec(res.json);
  const quota = asRec(root.quota_snapshots ?? root.quotaSnapshots);
  const resetsAt = isoFromIso(root.quota_reset_date ?? root.quotaResetDate);
  const windows: ProviderUsageWindow[] = [];
  for (const [key, label] of [
    ["premium_interactions", "premium"],
    ["premiumInteractions", "premium"],
    ["chat", "chat"],
    ["completions", "comp"],
  ] as const) {
    const snap = asRec(quota[key]);
    if (!snap || Object.keys(snap).length === 0) continue;
    if (windows.some((w) => w.id === label)) continue;
    const entitlement = pickNum(snap, "entitlement");
    if (snap.unlimited === true) {
      windows.push(detailWindow(label, label, "unlimited"));
      continue;
    }
    // CopilotUsageModels drops zero-entitlement placeholder snapshots.
    if (entitlement !== null && entitlement <= 0) continue;
    const usedPct = pickNum(snap, "percent_used", "percentUsed");
    const remainingPct = pickNum(snap, "percent_remaining", "percentRemaining");
    const remaining = pickNum(snap, "remaining");
    const util =
      usedPct ??
      (remainingPct !== null
        ? 100 - remainingPct
        : entitlement !== null && entitlement > 0 && remaining !== null
          ? ((entitlement - remaining) / entitlement) * 100
          : null);
    const win = windowOf(label, label, util, resetsAt);
    if (win) windows.push(win);
  }
  if (windows.length === 0) return errSnap("copilot", "no usable quota snapshots in response");
  return snapshotOk("copilot", windows);
}

async function fetchChutes(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("chutes", ["CHUTES_API_KEY"]);
  if (!key) return unauth("chutes", "missing CHUTES_API_KEY");
  const base = (envFirst(["CHUTES_API_URL"]) ?? "https://api.chutes.ai").replace(/\/$/, "");
  const res = await bearerJson("chutes", `${base}/users/me/subscription_usage`, key);
  if (!res.ok) return res.snap;
  // ChutesUsageStats: rolling-4h + monthly windows matched with broad,
  // underscore-insensitive keys; fractional percents (≤1) are ×100. The
  // pay-as-you-go /users/me/quotas fallback endpoints are not ported.
  const root = asRec(res.json);
  const data = asRec(root.data ?? root);
  const normalizeKey = (k: string) => k.toLowerCase().replace(/[_-]/g, "");
  const findBucket = (...names: string[]): Record<string, unknown> => {
    const targets = names.map(normalizeKey);
    for (const source of [data, root]) {
      for (const [k, v] of Object.entries(source)) {
        if (targets.includes(normalizeKey(k)) && v && typeof v === "object") return asRec(v);
      }
    }
    return {};
  };
  // ChutesUsageStats: |value| < 1 treated as a fraction (strict).
  const asPct = (v: number | null): number | null =>
    v === null ? null : Math.abs(v) < 1 ? v * 100 : v;
  const windows: ProviderUsageWindow[] = [];
  const buckets: Array<[Record<string, unknown>, string, string]> = [
    [
      findBucket("rolling", "rolling_window", "rolling_4h", "four_hour", "four_hour_usage", "window_4h"),
      "rolling",
      "4h",
    ],
    [
      findBucket("monthly", "monthly_usage", "subscription", "subscription_usage", "billing_period"),
      "monthly",
      "month",
    ],
  ];
  for (const [bucket, id, label] of buckets) {
    if (Object.keys(bucket).length === 0) continue;
    const util =
      asPct(pickNum(bucket, "utilization", "used_percent", "usedPercent", "percent_used", "percent")) ??
      percentUsed(pickNum(bucket, "used", "usage"), pickNum(bucket, "limit", "quota", "total"));
    const reset = bucket.resets_at ?? bucket.resetsAt ?? bucket.reset_at;
    const win = windowOf(id, label, util, isoFromIso(reset) ?? isoFromSecOrMs(reset));
    if (win) windows.push(win);
  }
  if (windows.length === 0) {
    return usedLimitWindows("chutes", [
      {
        id: "usage",
        label: "usage",
        used: pickNum(data, "used", "usage"),
        limit: pickNum(data, "limit", "quota"),
        remaining: pickNum(data, "remaining"),
      },
    ]);
  }
  return snapshotOk("chutes", windows);
}

async function fetchCrossModel(): Promise<ProviderUsageSnapshot> {
  // CrossModelUsageStats: `balance_micro` / `uncollected_micro` integers in
  // micro-USD (÷1e6). Prepaid wallet — the value is the point, not a percent.
  const key = configApiKey("crossmodel", ["CROSSMODEL_API_KEY"]);
  if (!key) return unauth("crossmodel", "missing CROSSMODEL_API_KEY");
  const base = (envFirst(["CROSSMODEL_API_URL"]) ?? "https://api.crossmodel.ai/v1").replace(/\/$/, "");
  const credits = await bearerJson("crossmodel", `${base}/credits`, key);
  if (!credits.ok) return credits.snap;
  const root = asRec(credits.json);
  const data = asRec(root.data ?? root);
  const balanceMicro = pickNum(data, "balance_micro", "balanceMicro");
  const uncollectedMicro = pickNum(data, "uncollected_micro", "uncollectedMicro");
  if (balanceMicro === null) return errSnap("crossmodel", "no balance_micro in credits response");
  const windows: ProviderUsageWindow[] = [
    detailWindow("balance", "bal", `$${formatAmount(balanceMicro / 1e6)}`),
  ];
  if (uncollectedMicro !== null && uncollectedMicro > 0) {
    windows.push(detailWindow("uncollected", "pending", `$${formatAmount(uncollectedMicro / 1e6)}`));
  }
  return snapshotOk("crossmodel", windows);
}

async function fetchCodebuff(): Promise<ProviderUsageSnapshot> {
  // CodebuffSettingsReader: CLI token lives at `default.authToken` (or
  // top-level `authToken`) in ~/.config/manicode/credentials.json; the usage
  // POST body carries a fingerprintId.
  let key = configApiKey("codebuff", ["CODEBUFF_API_KEY"]);
  if (!key) {
    const creds = readJsonHome(".config", "manicode", "credentials.json");
    if (creds) {
      key =
        pickString(asRec(creds.default), "authToken", "auth_token") ??
        pickString(creds, "authToken", "auth_token");
    }
  }
  if (!key) return unauth("codebuff", "missing CODEBUFF_API_KEY / manicode credentials (default.authToken)");
  const base = (envFirst(["CODEBUFF_API_URL"]) ?? "https://www.codebuff.com").replace(/\/$/, "");
  const res = await httpPost(
    `${base}/api/v1/usage`,
    { Authorization: `Bearer ${key}` },
    JSON.stringify({ fingerprintId: "missioncontrol-usage" }),
  );
  if (!res.ok) return mapHttpFailure("codebuff", res);
  const root = asRec(res.json);
  const remaining = pickNum(root, "remainingBalance", "remaining");
  const limit = pickNum(root, "quota", "limit");
  const used = pickNum(root, "usage", "used");
  const reset = isoFromIso(root.next_quota_reset ?? root.nextQuotaReset);
  return usedLimitWindows("codebuff", [
    { id: "credits", label: "credits", used, limit, remaining, resetsAt: reset, unit: "credits" },
  ]);
}

async function fetchDeepgram(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("deepgram", ["DEEPGRAM_API_KEY"]);
  if (!key) return unauth("deepgram", "missing DEEPGRAM_API_KEY");
  const base = (envFirst(["DEEPGRAM_API_URL"]) ?? "https://api.deepgram.com/v1").replace(/\/$/, "");
  const projects = await httpGet(`${base}/projects`, { Authorization: `Token ${key}` });
  if (!projects.ok) return mapHttpFailure("deepgram", projects);
  const root = asRec(projects.json);
  const list = Array.isArray(root.projects) ? root.projects : [];
  const projectId =
    envFirst(["DEEPGRAM_PROJECT_ID"]) ??
    (list[0] ? pickString(asRec(list[0]), "project_id", "projectId", "id") : null);
  if (!projectId) return errSnap("deepgram", "no Deepgram projects on this key");
  const balances = await httpGet(`${base}/projects/${projectId}/balances`, {
    Authorization: `Token ${key}`,
  });
  if (!balances.ok) return mapHttpFailure("deepgram", balances);
  const balRoot = asRec(balances.json);
  const balList = Array.isArray(balRoot.balances) ? balRoot.balances : [];
  let amount = 0;
  let sawAmount = false;
  for (const raw of balList) {
    const v = pickNum(asRec(raw), "amount", "balance");
    if (v !== null) {
      amount += v;
      sawAmount = true;
    }
  }
  if (!sawAmount) return errSnap("deepgram", "no balances on project");
  return snapshotOk("deepgram", [detailWindow("balance", "bal", `$${formatAmount(amount)}`)]);
}

async function fetchGroq(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("groq", ["GROQ_API_KEY"]);
  if (!key) return unauth("groq", "missing GROQ_API_KEY");
  const base = (envFirst(["GROQ_API_URL"]) ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  // Validate key; Prometheus enterprise metrics often unavailable on free keys.
  const res = await bearerJson("groq", `${base}/models`, key);
  if (!res.ok) return res.snap;
  return snapshotOk("groq", [detailWindow("api", "api", "key ok (no quota API)")]);
}

async function fetchWarp(): Promise<ProviderUsageSnapshot> {
  // CodexBar's Warp fetcher drives the app's private GraphQL schema (nested
  // user{...} query, anti-bot client headers). Deliberately not ported —
  // resolve the credential honestly and report the gap.
  const key = configApiKey("warp", ["WARP_API_KEY", "WARP_TOKEN"]);
  if (!key) return unauth("warp", "missing WARP_API_KEY / WARP_TOKEN");
  return errSnap("warp", "Warp usage uses the app's private GraphQL schema; not supported by this port");
}

async function fetchSynthetic(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("synthetic", ["SYNTHETIC_API_KEY"]);
  if (!key) return unauth("synthetic", "missing SYNTHETIC_API_KEY");
  const res = await bearerJson("synthetic", "https://api.synthetic.new/v2/quotas", key);
  if (!res.ok) return res.snap;
  // SyntheticUsageStats slot names: rollingFiveHourLimit, weeklyTokenLimit,
  // and nested search.hourly.
  const root = asRec(res.json);
  const data = asRec(root.data ?? root);
  const windows: ProviderUsageWindow[] = [];
  const buckets: Array<[Record<string, unknown>, string, string]> = [
    [asRec(data.rollingFiveHourLimit ?? root.rollingFiveHourLimit), "session", "session"],
    [asRec(data.weeklyTokenLimit ?? root.weeklyTokenLimit), "weekly", "week"],
    [asRec(asRec(data.search ?? root.search).hourly), "search", "search"],
  ];
  for (const [bucket, id, label] of buckets) {
    if (Object.keys(bucket).length === 0) continue;
    // SyntheticUsageStats: percents ≤1 are fractions; percentRemaining inverts.
    const asPct = (v: number | null): number | null => (v === null ? null : v <= 1 ? v * 100 : v);
    const remainingPct = asPct(
      pickNum(bucket, "percentRemaining", "remainingPercent", "remaining_percent", "percent_remaining"),
    );
    const util =
      asPct(
        pickNum(bucket, "percentUsed", "usedPercent", "usagePercent", "usage_percent", "used_percent", "percent_used", "percent", "utilization"),
      ) ??
      (remainingPct !== null ? 100 - remainingPct : null) ??
      percentUsed(
        pickNum(bucket, "used", "usage", "requests", "consumed", "spent"),
        pickNum(bucket, "limit", "quota", "max", "total", "capacity", "allowance"),
      );
    const reset =
      bucket.resetAt ?? bucket.reset_at ?? bucket.resetsAt ?? bucket.resets_at ?? bucket.periodEnd ?? bucket.period_end;
    const win = windowOf(id, label, util, isoFromIso(reset) ?? isoFromSecOrMs(reset));
    if (win && !windows.some((w) => w.id === id)) windows.push(win);
  }
  if (windows.length === 0) return errSnap("synthetic", "no quota slots in response");
  return snapshotOk("synthetic", windows);
}

async function fetchAmp(): Promise<ProviderUsageSnapshot> {
  // AmpUsageFetcher: POST {"method":"userDisplayBalanceInfo","params":{}} —
  // the response is {ok, result:{displayText}} where displayText is human
  // text ("$12.34", "Amp Free: 42% used") parsed textually.
  const key = configApiKey("amp", ["AMP_API_KEY"]);
  if (!key) return unauth("amp", "missing AMP_API_KEY");
  const res = await httpPost(
    "https://ampcode.com/api/internal?userDisplayBalanceInfo",
    { Authorization: `Bearer ${key}` },
    JSON.stringify({ method: "userDisplayBalanceInfo", params: {} }),
  );
  if (!res.ok) return mapHttpFailure("amp", res);
  const root = asRec(res.json);
  if (root.ok !== true) {
    const code = pickString(asRec(root.error), "code");
    if (code === "auth-required") return unauth("amp", "Amp token rejected (auth-required)");
    return errSnap("amp", `balance RPC failed${code ? ` (${code})` : ""}`);
  }
  const displayText = pickString(asRec(root.result), "displayText") ?? "";
  if (!displayText) return errSnap("amp", "no displayText in balance response");
  // AmpUsageParser: "Amp Free: $<remaining> / $<quota> remaining (replenishes
  // +$<hourly> / hour)" and "Individual credits: $<n> remaining".
  const amount = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const windows: ProviderUsageWindow[] = [];
  const numOf = (s: string | undefined): number | null =>
    s == null ? null : num(s.replace(/,/g, ""));
  const free = displayText.match(
    new RegExp(`^\\s*Amp Free:\\s*\\$?${amount}\\s*/\\s*\\$?${amount}\\s+remaining`, "im"),
  );
  const freeRemaining = numOf(free?.[1]);
  const freeQuota = numOf(free?.[2]);
  if (freeRemaining !== null && freeQuota !== null && freeQuota > 0) {
    const used = Math.max(0, freeQuota - freeRemaining);
    const win = windowOf("free", "free", (used / freeQuota) * 100);
    if (win) windows.push(win);
  }
  const credits = numOf(
    displayText.match(new RegExp(`^\\s*Individual credits:\\s*\\$?${amount}\\s+remaining`, "im"))?.[1],
  );
  if (credits !== null) windows.push(detailWindow("balance", "bal", `$${formatAmount(credits)}`));
  if (windows.length === 0) windows.push(detailWindow("balance", "bal", displayText.slice(0, 40)));
  return snapshotOk("amp", windows);
}

async function fetchKilo(): Promise<ProviderUsageSnapshot> {
  // KiloUsageFetcher: tRPC batch GET on app.kilo.ai/api/trpc — creditBlocks[]
  // carry amount_mUsd (total) and balance_mUsd (remaining) in micro-USD.
  let key = configApiKey("kilo", ["KILO_API_KEY"]);
  if (!key) {
    const auth = readJsonHome(".local", "share", "kilo", "auth.json");
    if (auth) key = pickString(asRec(auth.kilo), "access", "token") ?? pickString(auth, "access", "token");
  }
  if (!key) return unauth("kilo", "missing KILO_API_KEY / ~/.local/share/kilo/auth.json");
  const procedures = ["user.getCreditBlocks", "kiloPass.getState", "user.getAutoTopUpPaymentMethod"];
  const input = encodeURIComponent(
    JSON.stringify(Object.fromEntries(procedures.map((_, i) => [String(i), { json: null }]))),
  );
  const base = (envFirst(["KILO_API_URL"]) ?? "https://app.kilo.ai/api/trpc").replace(/\/$/, "");
  const res = await httpGet(`${base}/${procedures.join(",")}?batch=1&input=${input}`, {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  });
  if (!res.ok) return mapHttpFailure("kilo", res);
  const entries = Array.isArray(res.json) ? res.json : [res.json];
  const payloadOf = (entry: unknown): unknown => {
    const result = asRec(asRec(entry).result);
    const data = asRec(result.data);
    return data.json ?? (Object.keys(data).length > 0 ? data : asRec(result).json);
  };
  const creditPayload = payloadOf(entries[0]);
  const blocks = deepFind(creditPayload, "creditBlocks");
  let total = 0;
  let remaining = 0;
  let sawTotal = false;
  let sawRemaining = false;
  if (Array.isArray(blocks)) {
    for (const raw of blocks) {
      const block = asRec(raw);
      const amount = pickNum(block, "amount_mUsd");
      const balance = pickNum(block, "balance_mUsd");
      if (amount !== null) {
        total += amount / 1e6;
        sawTotal = true;
      }
      if (balance !== null) {
        remaining += balance / 1e6;
        sawRemaining = true;
      }
    }
  }
  if (!sawTotal || !sawRemaining) {
    const balanceMicro = num(deepFind(creditPayload, "totalBalance_mUsd"));
    if (balanceMicro !== null) {
      return snapshotOk("kilo", [detailWindow("balance", "bal", `$${formatAmount(balanceMicro / 1e6)}`)]);
    }
    return errSnap("kilo", "no creditBlocks in tRPC response");
  }
  return usedLimitWindows("kilo", [
    { id: "credits", label: "credits", used: total - remaining, limit: total, unit: "USD" },
  ]);
}

async function fetchLlmProxy(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("llmproxy", ["LLM_PROXY_API_KEY", "LLMPROXY_API_KEY"]);
  const base =
    envFirst(["LLM_PROXY_BASE_URL", "LLMPROXY_BASE_URL"]) ??
    configEnterpriseHost("llmproxy") ??
    null;
  if (!key || !base) return unauth("llmproxy", "missing LLM_PROXY_API_KEY / LLM_PROXY_BASE_URL");
  // LLMProxyUsageFetcher: remaining lives nested per provider →
  // quota_groups[].remaining_percent; utilization = 100 − min(remaining).
  let host = base.replace(/\/$/, "").replace(/\/v1$/, "");
  if (!host.startsWith("http")) host = `https://${host}`;
  const res = await bearerJson("llmproxy", `${host}/v1/quota-stats`, key);
  if (!res.ok) return res.snap;
  const root = asRec(res.json);
  const providers = asRec(root.providers);
  let lowest: number | null = null;
  let earliestReset: number | null = null;
  for (const value of Object.values(providers)) {
    const rawGroups = asRec(value).quota_groups ?? asRec(value).quotaGroups;
    // quota_groups decodes as an array or a name-keyed object.
    const groups = Array.isArray(rawGroups)
      ? rawGroups
      : rawGroups && typeof rawGroups === "object"
        ? Object.values(rawGroups)
        : [];
    for (const raw of groups) {
      const group = asRec(raw);
      const remaining = pickNum(group, "remaining_percent", "remainingPercent");
      if (remaining !== null) lowest = lowest === null ? remaining : Math.min(lowest, remaining);
      const reset = isoFromIso(group.reset_time) ?? isoFromSecOrMs(group.reset_time);
      if (reset) {
        const t = Date.parse(reset);
        if (earliestReset === null || t < earliestReset) earliestReset = t;
      }
    }
  }
  if (lowest === null) return errSnap("llmproxy", "no quota_groups remaining_percent in response");
  return usedLimitWindows("llmproxy", [
    {
      id: "quota",
      label: "quota",
      utilization: 100 - lowest,
      resetsAt: earliestReset !== null ? new Date(earliestReset).toISOString() : null,
    },
  ]);
}

async function fetchLiteLlm(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("litellm", ["LITELLM_API_KEY"]);
  const base = envFirst(["LITELLM_BASE_URL"]) ?? configEnterpriseHost("litellm");
  if (!key || !base) return unauth("litellm", "missing LITELLM_API_KEY / LITELLM_BASE_URL");
  // LiteLLMUsageFetcher: /key/info only has spend; max_budget comes from
  // /user/info?user_id= or /team/info?team_id= depending on key ownership.
  let host = base.replace(/\/$/, "").replace(/\/v1$/, "");
  if (!host.startsWith("http")) host = `https://${host}`;
  const res = await bearerJson("litellm", `${host}/key/info`, key);
  if (!res.ok) return res.snap;
  const keyInfo = asRec(asRec(res.json).info ?? asRec(res.json).data ?? res.json);
  let spend = pickNum(keyInfo, "spend", "total_spend");
  let maxBudget = pickNum(keyInfo, "max_budget", "maxBudget");
  const userId = pickString(keyInfo, "user_id", "userId");
  const teamId = pickString(keyInfo, "team_id", "teamId");
  if (maxBudget === null) {
    const scoped = userId
      ? await bearerJson("litellm", `${host}/user/info?user_id=${encodeURIComponent(userId)}`, key)
      : teamId
        ? await bearerJson("litellm", `${host}/team/info?team_id=${encodeURIComponent(teamId)}`, key)
        : null;
    if (scoped?.ok) {
      const scopedInfo = asRec(deepFind(scoped.json, "user_info") ?? deepFind(scoped.json, "team_info") ?? asRec(scoped.json).info ?? scoped.json);
      maxBudget = pickNum(scopedInfo, "max_budget", "maxBudget");
      spend = pickNum(scopedInfo, "spend", "total_spend") ?? spend;
    }
  }
  return usedLimitWindows("litellm", [
    { id: "budget", label: "budget", used: spend, limit: maxBudget, unit: "USD" },
  ]);
}

async function fetchClawRouter(): Promise<ProviderUsageSnapshot> {
  const key = configApiKey("clawrouter", ["CLAWROUTER_API_KEY"]);
  if (!key) return unauth("clawrouter", "missing CLAWROUTER_API_KEY");
  const base =
    envFirst(["CLAWROUTER_BASE_URL"]) ??
    configEnterpriseHost("clawrouter") ??
    "https://clawrouter.openclaw.ai";
  let host = base.replace(/\/$/, "").replace(/\/v1$/, "");
  if (!host.startsWith("http")) host = `https://${host}`;
  const res = await bearerJson("clawrouter", `${host}/v1/usage`, key);
  if (!res.ok) return res.snap;
  const root = asRec(res.json);
  const budget = asRec(root.budget ?? root);
  const limitMicros = pickNum(budget, "limitMicros", "limit_micros");
  const remainingMicros = pickNum(budget, "remainingMicros", "remaining_micros");
  const spentMicros = pickNum(budget, "spentMicros", "spent_micros", "used_micros");
  const limit = limitMicros !== null ? limitMicros / 1e6 : pickNum(budget, "limit", "limitUSD");
  const remaining =
    remainingMicros !== null ? remainingMicros / 1e6 : pickNum(budget, "remaining", "remainingUSD");
  const used = spentMicros !== null ? spentMicros / 1e6 : pickNum(budget, "spent", "used");
  // ClawRouterUsageFetcher derives the reset from budget.windowKey ("YYYY-MM"):
  // the window resets at the start of the following month (UTC).
  let resetsAt: string | null = null;
  const windowKey = pickString(budget, "windowKey", "window_key");
  const wk = windowKey?.match(/^(\d{4})-(\d{2})$/);
  if (wk) {
    resetsAt = new Date(Date.UTC(Number(wk[1]), Number(wk[2]), 1)).toISOString();
  }
  return usedLimitWindows("clawrouter", [
    { id: "budget", label: "budget", used, limit, remaining, resetsAt, unit: "USD" },
  ]);
}

// ── Cookie / web providers ──────────────────────────────────────────────────

async function cookieProvider(
  id: ProviderUsageId,
  envKeys: string[],
  url: string,
  parse: (json: unknown, text: string) => ProviderUsageSnapshot,
  extraHeaders: Record<string, string> = {},
): Promise<ProviderUsageSnapshot> {
  const cookie = configCookie(id, envKeys);
  if (!cookie) return unauth(id, `missing cookie/env (${envKeys.join(", ") || "config"})`);
  const res = await cookieJson(id, url, cookie, extraHeaders);
  if (!res.ok) return res.snap;
  return parse(res.json, res.text);
}

async function fetchOpenCode(): Promise<ProviderUsageSnapshot> {
  // CodexBar's OpenCode source is browser cookies driving a two-step TanStack
  // `/_server` function protocol (text/javascript responses) — deliberately not
  // ported (web-scrape tier). Report honestly instead of probing invented URLs.
  const cookie = configCookie("opencode", ["OPENCODE_COOKIE"]);
  if (!cookie) {
    return unauth("opencode", "missing OPENCODE_COOKIE / config cookie (browser session)");
  }
  return errSnap(
    "opencode",
    "OpenCode web usage uses the opencode.ai /_server function protocol, which this port does not implement",
  );
}

// OpenCodeGoLocalUsageReader: hardcoded plan limits (USD) per window.
const OPENCODEGO_LIMITS = { session: 12, weekly: 30, monthly: 60 } as const;

async function fetchOpenCodeGo(): Promise<ProviderUsageSnapshot> {
  // OpenCodeGoLocalUsageReader: parse ~/.local/share/opencode/opencode.db —
  // sum assistant-message costs per window against the hardcoded plan limits.
  const dbPath = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
  if (!fs.existsSync(dbPath)) {
    return unauth("opencodego", "no local OpenCode Go database (~/.local/share/opencode/opencode.db)");
  }
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 250 });
    try {
      const rows = db
        .prepare(
          "SELECT json_extract(data,'$.time.created') AS created, json_extract(data,'$.cost') AS cost " +
            "FROM message WHERE json_extract(data,'$.providerID')='opencode-go' AND json_extract(data,'$.role')='assistant'",
        )
        .all() as Array<{ created: unknown; cost: unknown }>;
      const now = Date.now();
      const sums = { session: 0, weekly: 0, monthly: 0 };
      for (const row of rows) {
        const created = num(row.created);
        const cost = num(row.cost);
        if (created === null || cost === null) continue;
        const ms = created > 1e12 ? created : created * 1000;
        const age = now - ms;
        if (age < 0) continue;
        if (age <= 5 * 3600_000) sums.session += cost;
        if (age <= 7 * 86400_000) sums.weekly += cost;
        if (age <= 30 * 86400_000) sums.monthly += cost;
      }
      return usedLimitWindows("opencodego", [
        { id: "session", label: "session", used: sums.session, limit: OPENCODEGO_LIMITS.session },
        { id: "weekly", label: "week", used: sums.weekly, limit: OPENCODEGO_LIMITS.weekly },
        { id: "monthly", label: "month", used: sums.monthly, limit: OPENCODEGO_LIMITS.monthly },
      ]);
    } finally {
      db.close();
    }
  } catch (err) {
    return errSnap(
      "opencodego",
      `opencode.db read failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
}

async function fetchFactory(): Promise<ProviderUsageSnapshot> {
  // FactoryStatusProbe: browser session cookies → GET /api/app/auth/me for the
  // user id, then GET /api/organization/subscription/usage?useCache=true&userId=.
  // All requests need Origin/Referer plus `x-factory-client: web-app`.
  const cookie = configCookie("factory", ["FACTORY_COOKIE"]);
  if (!cookie) return unauth("factory", "missing FACTORY_COOKIE / config cookie (browser session)");
  const headers: Record<string, string> = {
    Cookie: cookie,
    Origin: "https://app.factory.ai",
    Referer: "https://app.factory.ai/",
    "x-factory-client": "web-app",
    "User-Agent": CHROME_UA,
  };
  // Preferred source: billing limits (fiveHour/weekly/monthly usedPercent).
  const limitsRes = await httpGet("https://api.factory.ai/api/billing/limits", headers);
  if (limitsRes.ok) {
    const pool = asRec(asRec(asRec(limitsRes.json).limits).standard ?? asRec(asRec(limitsRes.json).limits).core);
    const winFrom = (bucket: Record<string, unknown>, id: string, label: string) => {
      const pct = pickNum(bucket, "usedPercent");
      const secs = pickNum(bucket, "secondsRemaining");
      const resetsAt =
        secs !== null && secs > 0
          ? new Date(Date.now() + secs * 1000).toISOString()
          : (isoFromIso(bucket.windowEnd) ?? isoFromSecOrMs(bucket.windowEnd));
      return windowOf(id, label, pct, resetsAt);
    };
    const windows = [
      winFrom(asRec(pool.fiveHour), "session", "session"),
      winFrom(asRec(pool.weekly), "weekly", "week"),
      winFrom(asRec(pool.monthly), "monthly", "month"),
    ].filter((w): w is ProviderUsageWindow => w !== null);
    if (windows.length > 0) return snapshotOk("factory", windows);
  } else if (limitsRes.status === 401 || limitsRes.status === 403) {
    return mapHttpFailure("factory", limitsRes);
  }

  // Fallback: subscription usage ratios (userId from auth/me when available).
  const me = await httpGet("https://app.factory.ai/api/app/auth/me", headers);
  if (!me.ok) return mapHttpFailure("factory", me);
  const meRoot = asRec(me.json);
  const userId =
    pickString(meRoot, "id", "userId", "user_id") ??
    pickString(asRec(meRoot.user), "id", "userId", "user_id");
  const usageUrl = userId
    ? `https://app.factory.ai/api/organization/subscription/usage?useCache=true&userId=${encodeURIComponent(userId)}`
    : "https://app.factory.ai/api/organization/subscription/usage?useCache=true";
  const usage = await httpGet(usageUrl, headers);
  if (!usage.ok) return mapHttpFailure("factory", usage);
  const root = asRec(usage.json);
  const usageRec = asRec(root.usage ?? root);
  const ratioPct = (o: Record<string, unknown>): number | null => {
    const r = pickNum(o, "usedRatio", "used_ratio");
    return r === null ? null : r * 100;
  };
  const endDate = num(asRec(root.usage ?? root).endDate) ?? num(deepFind(root, "endDate"));
  const resetsAt = endDate !== null ? isoFromSecOrMs(endDate) : isoFromIso(deepFind(root, "endDate"));
  return usedLimitWindows("factory", [
    { id: "standard", label: "std", utilization: ratioPct(asRec(usageRec.standard)), resetsAt },
    { id: "premium", label: "premium", utilization: ratioPct(asRec(usageRec.premium)), resetsAt },
  ]);
}

async function fetchDevin(): Promise<ProviderUsageSnapshot> {
  // DevinUsageFetcher: Bearer token only (no cookie mode); org from
  // DEVIN_ORGANIZATION / DEVIN_ORG, tried as org/<slug>, organizations/<id>,
  // and bare internal id (bare ids also send `x-cog-org-id`).
  const token = configApiKey("devin", ["DEVIN_BEARER_TOKEN", "DEVIN_AUTHORIZATION"]);
  if (!token) return unauth("devin", "missing DEVIN_BEARER_TOKEN / DEVIN_AUTHORIZATION");
  const org = envFirst(["DEVIN_ORGANIZATION", "DEVIN_ORG"]);
  if (!org) return unauth("devin", "missing DEVIN_ORGANIZATION / DEVIN_ORG");
  const bearer = token.startsWith("Bearer ") ? token.slice(7) : token;
  const cleaned = org.replace(/^\/+|\/+$/g, "");
  const candidates = cleaned.includes("/")
    ? [cleaned]
    : [`org/${cleaned}`, `organizations/${cleaned}`, cleaned];

  // DevinUsageSnapshot scales primary percentages with a strict < 1 check.
  const pct = (v: number | null): number | null => (v === null ? null : v < 1 ? v * 100 : v);
  let last: ProviderUsageSnapshot | null = null;
  for (const candidate of candidates) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": CHROME_UA,
    };
    if (!candidate.includes("/")) headers["x-cog-org-id"] = candidate;
    const res = await httpGet(`https://app.devin.ai/api/${candidate}/billing/quota/usage`, headers);
    if (!res.ok) {
      last = mapHttpFailure("devin", res);
      continue;
    }
    const root = asRec(res.json);
    const daily = pct(pickNum(root, "daily_percentage", "dailyPercentage"));
    const weekly = pct(pickNum(root, "weekly_percentage", "weeklyPercentage"));
    const remaining = pickNum(root, "remaining_percent", "remainingPercent");
    const fallback = remaining !== null ? 100 - (remaining <= 1 ? remaining * 100 : remaining) : null;
    return usedLimitWindows("devin", [
      {
        id: "daily",
        label: "day",
        utilization: daily ?? fallback,
        resetsAt: isoFromIso(root.daily_reset_at) ?? isoFromSecOrMs(root.daily_reset_at),
      },
      {
        id: "weekly",
        label: "week",
        utilization: weekly,
        resetsAt: isoFromIso(root.weekly_reset_at) ?? isoFromSecOrMs(root.weekly_reset_at),
      },
    ]);
  }
  return last ?? errSnap("devin", "no usable org path");
}

async function fetchMinimax(): Promise<ProviderUsageSnapshot> {
  // MiniMaxUsageFetcher: GET /v1/token_plan/remains, falling back to
  // /v1/api/openplatform/coding_plan/remains. `current_interval_usage_count`
  // in model_remains[] is REMAINING (inverted), not used.
  const key = configApiKey("minimax", ["MINIMAX_CODING_API_KEY", "MINIMAX_API_KEY"]);
  if (!key) {
    return unauth(
      "minimax",
      "missing MINIMAX_CODING_API_KEY / MINIMAX_API_KEY (web-cookie HTML path not ported)",
    );
  }
  const host = (envFirst(["MINIMAX_HOST"]) ?? "https://api.minimax.io").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${key}`, "MM-API-Source": "MissionControl" };
  let res = await httpGet(`${host}/v1/token_plan/remains`, headers);
  if (!res.ok) {
    res = await httpGet(`${host}/v1/api/openplatform/coding_plan/remains`, headers);
  }
  if (!res.ok) return mapHttpFailure("minimax", res);
  const root = asRec(res.json);
  const remains = deepFind(root, "model_remains");
  const windows: ProviderUsageWindow[] = [];
  // Per entry: `*_usage_count` is REMAINING; prefer the explicit
  // `*_remaining_percent`; reset = end_time if future else now + remains_time.
  const entryWindow = (
    entry: Record<string, unknown>,
    prefix: "current_interval" | "current_weekly",
    id: string,
    label: string,
  ): ProviderUsageWindow | null => {
    const remainingPct = pickNum(entry, `${prefix}_remaining_percent`);
    const remaining = pickNum(entry, `${prefix}_usage_count`);
    const total = pickNum(entry, `${prefix}_total_count`);
    const util =
      remainingPct !== null
        ? 100 - remainingPct
        : remaining !== null && total !== null && total > 0
          ? ((total - remaining) / total) * 100
          : null;
    const endKey = prefix === "current_interval" ? "end_time" : "weekly_end_time";
    const remainsKey = prefix === "current_interval" ? "remains_time" : "weekly_remains_time";
    let resetsAt = isoFromSecOrMs(entry[endKey]) ?? isoFromIso(entry[endKey]);
    if (!resetsAt || Date.parse(resetsAt) <= Date.now()) {
      const remainsSec = num(entry[remainsKey]);
      if (remainsSec !== null) {
        const sec = remainsSec > 1e6 ? remainsSec / 1000 : remainsSec;
        resetsAt = new Date(Date.now() + sec * 1000).toISOString();
      }
    }
    return windowOf(id, label, util, resetsAt);
  };
  if (Array.isArray(remains)) {
    for (const raw of remains) {
      const entry = asRec(raw);
      const name = (pickString(entry, "model_name", "modelName", "name") ?? "plan").slice(0, 10);
      const interval = entryWindow(entry, "current_interval", name, name);
      if (interval) windows.push(interval);
      const weekly = entryWindow(entry, "current_weekly", `${name}-wk`, `${name} wk`);
      if (weekly) windows.push(weekly);
    }
  }
  if (windows.length === 0) return errSnap("minimax", "no model_remains entries in response");
  return snapshotOk("minimax", windows.slice(0, 4));
}

async function fetchManus(): Promise<ProviderUsageSnapshot> {
  // ManusUsageFetcher: session_id cookie value used as a Bearer token on a
  // Connect-RPC endpoint (no Cookie header). Monthly gauge only when
  // proMonthlyCredits > 0; refresh window gated on maxRefreshCredits > 0.
  const raw = configCookie("manus", ["MANUS_SESSION_TOKEN", "MANUS_SESSION_ID", "MANUS_COOKIE"]);
  if (!raw) return unauth("manus", "missing MANUS_SESSION_TOKEN / MANUS_COOKIE");
  const session = raw.includes("=") ? raw.match(/(?:^|;\s*)session_id=([^;]+)/i)?.[1] : raw;
  if (!session) return unauth("manus", "session_id not found in cookie header");
  const res = await httpPost(
    "https://api.manus.im/user.v1.UserService/GetAvailableCredits",
    {
      Authorization: `Bearer ${session}`,
      "Connect-Protocol-Version": "1",
      Origin: "https://manus.im",
      Referer: "https://manus.im/",
    },
    "{}",
  );
  if (!res.ok) return mapHttpFailure("manus", res);
  const root = asRec(res.json);
  const total = pickNum(root, "totalCredits", "total_credits");
  const periodic = pickNum(root, "periodicCredits", "periodic_credits");
  const proMonthly = pickNum(root, "proMonthlyCredits", "pro_monthly_credits");
  const refresh = pickNum(root, "refreshCredits", "refresh_credits");
  const maxRefresh = pickNum(root, "maxRefreshCredits", "max_refresh_credits");
  const resetsAt = isoFromIso(root.nextRefreshTime ?? root.next_refresh_time);
  const windows: ProviderUsageWindow[] = [];
  if (proMonthly !== null && proMonthly > 0 && periodic !== null) {
    const win = windowOf("monthly", "month", ((proMonthly - periodic) / proMonthly) * 100, resetsAt);
    if (win) windows.push(win);
  }
  if (maxRefresh !== null && maxRefresh > 0 && refresh !== null) {
    const win = windowOf("refresh", "refresh", ((maxRefresh - refresh) / maxRefresh) * 100, resetsAt);
    if (win) windows.push(win);
  }
  if (total !== null) {
    windows.push(detailWindow("credits", "credits", formatAmount(total, "credits")));
  }
  if (windows.length === 0) return errSnap("manus", "no credit fields in response");
  return snapshotOk("manus", windows);
}

async function fetchPerplexity(): Promise<ProviderUsageSnapshot> {
  // PerplexityUsageFetcher: credit-grants/cents model — balance_cents,
  // total_usage_cents, credit_grants[{type, amount_cents, expires_at_ts}],
  // renewal_date_ts (unix seconds). Session cookie is
  // `__Secure-next-auth.session-token` (bare env tokens are wrapped as such).
  const cookie = configCookie(
    "perplexity",
    ["PERPLEXITY_SESSION_TOKEN", "PERPLEXITY_COOKIE"],
    "__Secure-next-auth.session-token",
  );
  if (!cookie) return unauth("perplexity", "missing PERPLEXITY_SESSION_TOKEN / PERPLEXITY_COOKIE");
  const res = await httpGet(
    "https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default",
    {
      Cookie: cookie,
      Origin: "https://www.perplexity.ai",
      Referer: "https://www.perplexity.ai/account/usage",
      "User-Agent": CHROME_UA,
    },
  );
  if (!res.ok) return mapHttpFailure("perplexity", res);
  const root = asRec(res.json);
  const balanceCents = pickNum(root, "balance_cents", "balanceCents");
  const usedCents = pickNum(root, "total_usage_cents", "totalUsageCents") ?? 0;
  const purchasedPeriodCents = pickNum(root, "current_period_purchased_cents") ?? 0;
  const grants = Array.isArray(root.credit_grants) ? root.credit_grants : [];
  // PerplexityUsageSnapshot: group grants by type (promos filtered to
  // non-expired), then attribute total_usage_cents recurring → purchased →
  // promotional.
  const nowSec = Date.now() / 1000;
  let recurringSum = 0;
  let promoSum = 0;
  let purchasedFromGrants = 0;
  for (const raw of grants) {
    const grant = asRec(raw);
    const amount = pickNum(grant, "amount_cents", "amountCents");
    if (amount === null) continue;
    const type = String(grant.type ?? "");
    if (type === "recurring") recurringSum += amount;
    else if (type === "promotional") {
      const expires = pickNum(grant, "expires_at_ts");
      if (expires === null || expires > nowSec) promoSum += amount;
    } else if (type === "purchased") purchasedFromGrants += amount;
  }
  const purchasedSum = Math.max(purchasedFromGrants, purchasedPeriodCents);
  let remaining = usedCents;
  const usedFromRecurring = Math.min(remaining, recurringSum);
  remaining -= usedFromRecurring;
  const usedFromPurchased = Math.min(remaining, purchasedSum);
  remaining -= usedFromPurchased;
  const usedFromPromo = Math.min(remaining, promoSum);

  const resetsAt = isoFromSecOrMs(root.renewal_date_ts ?? root.renewalDateTs);
  const clampPct = (used: number, total: number) => Math.min(100, Math.max(0, (used / total) * 100));
  const windows: ProviderUsageWindow[] = [];
  if (recurringSum > 0) {
    const win = windowOf("credits", "monthly", clampPct(usedFromRecurring, recurringSum), resetsAt);
    if (win) windows.push(win);
  }
  if (promoSum > 0) {
    const win = windowOf("promo", "bonus", clampPct(usedFromPromo, promoSum));
    if (win) windows.push(win);
  }
  if (purchasedSum > 0) {
    const win = windowOf("purchased", "purchased", clampPct(usedFromPurchased, purchasedSum));
    if (win) windows.push(win);
  }
  if (balanceCents !== null) {
    windows.push(detailWindow("balance", "bal", `$${formatAmount(balanceCents / 100)}`, resetsAt));
  }
  if (windows.length === 0) return errSnap("perplexity", "no credit fields in response");
  return snapshotOk("perplexity", windows);
}

async function fetchMistral(): Promise<ProviderUsageSnapshot> {
  // MistralUsageFetcher: the only real %-gauge is the Vibe window on
  // console.mistral.ai (usage_percentage + reset_at); the admin credits
  // endpoint gives wallet_amount/credit_notes_amount/ongoing_usage_balance
  // (available = wallet + credit_notes − ongoing). The v2/usage per-token
  // spend computation (token counts × price table) is not ported.
  const cookie = configCookie("mistral", ["MISTRAL_COOKIE"]);
  if (!cookie) return unauth("mistral", "missing MISTRAL_COOKIE (ory_session_* + csrftoken cookies)");
  const csrf = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/i)?.[1];
  const windows: ProviderUsageWindow[] = [];
  // MistralUsageFetcher: exact tRPC batch query string; header is X-CSRFToken
  // on the console host, X-CSRFTOKEN on admin.
  const vibeHeaders: Record<string, string> = { Accept: "*/*", Cookie: cookie };
  if (csrf) vibeHeaders["X-CSRFToken"] = csrf;
  const vibe = await httpGet(
    "https://console.mistral.ai/api-ui/trpc/billing.vibeUsage?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%7D",
    vibeHeaders,
  );
  if (vibe.ok) {
    const pct = num(deepFind(vibe.json, "usage_percentage") ?? deepFind(vibe.json, "vibe_usage"));
    const reset = deepFind(vibe.json, "reset_at");
    const win = windowOf("vibe", "vibe", pct, isoFromIso(reset) ?? isoFromSecOrMs(reset));
    if (win) windows.push(win);
  }
  const creditHeaders: Record<string, string> = {
    Accept: "*/*",
    Cookie: cookie,
    Origin: "https://admin.mistral.ai",
    Referer: "https://admin.mistral.ai/organization/billing",
  };
  if (csrf) creditHeaders["X-CSRFTOKEN"] = csrf;
  const credits = await httpGet("https://admin.mistral.ai/api/billing/credits", creditHeaders);
  if (credits.ok) {
    const c = asRec(credits.json);
    const wallet = pickNum(c, "wallet_amount", "walletAmount");
    const notes = pickNum(c, "credit_notes_amount", "creditNotesAmount");
    const ongoing = pickNum(c, "ongoing_usage_balance", "ongoingUsageBalance");
    if (wallet !== null || notes !== null) {
      const available = (wallet ?? 0) + (notes ?? 0) - (ongoing ?? 0);
      windows.push(detailWindow("credits", "credits", formatAmount(available, "EUR")));
    }
  }
  if (windows.length === 0) {
    if (!vibe.ok && (vibe.status === 401 || vibe.status === 403)) return mapHttpFailure("mistral", vibe);
    return errSnap("mistral", "no vibe usage or credits fields in response");
  }
  return snapshotOk("mistral", windows);
}

async function fetchT3Chat(): Promise<ProviderUsageSnapshot> {
  // T3ChatUsageFetcher: tRPC batch GET (JSONL response) with web-client
  // headers; fields usageFourHourPercentage / usageMonthPercentage.
  const cookie = configCookie("t3chat", ["T3CHAT_COOKIE", "T3_COOKIE"]);
  if (!cookie) return unauth("t3chat", "missing T3CHAT_COOKIE (full browser cookie header)");
  const input = encodeURIComponent(
    JSON.stringify({ "0": { json: { sessionId: null }, meta: { values: { sessionId: ["undefined"] } } } }),
  );
  const res = await httpGet(`https://t3.chat/api/trpc/getCustomerData?batch=1&input=${input}`, {
    Cookie: cookie,
    "trpc-accept": "application/jsonl",
    "x-trpc-source": "web-client",
    "x-trpc-batch": "true",
    Origin: "https://t3.chat",
    Referer: "https://t3.chat/",
    "User-Agent": CHROME_UA,
  });
  if (!res.ok) return mapHttpFailure("t3chat", res);
  // JSONL: parse every line, search the trees for the usage fields.
  const parsed: unknown[] = [];
  if (res.json) parsed.push(res.json);
  for (const line of res.text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) continue;
    try {
      parsed.push(JSON.parse(t));
    } catch {
      /* skip non-JSON lines */
    }
  }
  const find = (key: string): unknown => {
    for (const p of parsed) {
      const v = deepFind(p, key);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const fourHour = num(find("usageFourHourPercentage"));
  const fourHourReset = isoFromIso(find("usageFourHourNextResetAt")) ?? isoFromSecOrMs(find("usageFourHourNextResetAt"));
  const month = num(find("usageMonthPercentage")) ?? num(find("usagePeriodPercentage"));
  const monthReset = isoFromIso(find("currentPeriodEnd")) ?? isoFromSecOrMs(find("currentPeriodEnd"));
  return usedLimitWindows("t3chat", [
    { id: "base", label: "4h", utilization: fourHour, resetsAt: fourHourReset },
    { id: "month", label: "month", utilization: month, resetsAt: monthReset },
  ]);
}

async function fetchWindsurf(): Promise<ProviderUsageSnapshot> {
  // WindsurfStatusProbe: parse `windsurf.settings.cachedPlanInfo` from the
  // local state.vscdb — quotaUsage.{daily,weekly}RemainingPercent are
  // REMAINING (util = 100 − remaining), resets are unix seconds. CodexBar's
  // path is macOS-only; the %APPDATA% candidate is a port extension for the
  // same VSCode-fork layout. The web GetPlanStatus endpoint is Connect-RPC
  // protobuf and is not ported.
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Windsurf", "User", "globalStorage", "state.vscdb")]
      : process.platform === "darwin"
        ? [path.join(home, "Library", "Application Support", "Windsurf", "User", "globalStorage", "state.vscdb")]
        : [path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config"), "Windsurf", "User", "globalStorage", "state.vscdb")];
  const dbPath = candidates.find((p) => fs.existsSync(p));
  if (!dbPath) {
    return unauth("windsurf", "no local Windsurf state.vscdb (web plan-status endpoint is protobuf-only, not ported)");
  }
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 250 });
    let raw: string | null = null;
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'windsurf.settings.cachedPlanInfo' LIMIT 1")
        .get() as { value?: unknown } | undefined;
      if (typeof row?.value === "string") raw = row.value;
      else if (Buffer.isBuffer(row?.value)) raw = row.value.toString("utf8");
    } finally {
      db.close();
    }
    if (!raw) return unauth("windsurf", "no cachedPlanInfo in Windsurf state — sign in to Windsurf first");
    const info = asRec(JSON.parse(raw));
    const quota = asRec(info.quotaUsage);
    const usage = asRec(info.usage);
    const windows: ProviderUsageWindow[] = [];
    const dailyRemaining = pickNum(quota, "dailyRemainingPercent");
    const weeklyRemaining = pickNum(quota, "weeklyRemainingPercent");
    const daily = windowOf("daily", "day", dailyRemaining === null ? null : 100 - dailyRemaining, isoFromSecOrMs(quota.dailyResetAtUnix));
    if (daily) windows.push(daily);
    const weekly = windowOf("weekly", "week", weeklyRemaining === null ? null : 100 - weeklyRemaining, isoFromSecOrMs(quota.weeklyResetAtUnix));
    if (weekly) windows.push(weekly);
    if (windows.length === 0) {
      const credits = windowOf(
        "credits",
        "credits",
        percentUsed(pickNum(usage, "usedFlexCredits"), pickNum(usage, "flexCredits")) ??
          percentUsed(pickNum(usage, "usedMessages"), pickNum(usage, "messages")),
        isoFromSecOrMs(info.endTimestamp),
      );
      if (credits) windows.push(credits);
    }
    if (windows.length === 0) return errSnap("windsurf", "cachedPlanInfo had no quota fields");
    return snapshotOk("windsurf", windows);
  } catch (err) {
    return errSnap("windsurf", `state.vscdb read failed: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

async function fetchMimo(): Promise<ProviderUsageSnapshot> {
  // MiMoUsageFetcher: needs `api-platform_serviceToken` + `userId` cookies.
  // Real utilization comes from /tokenPlan/usage (monthUsage.items[0]);
  // /balance is a currency string shown as a detail line.
  const cookie = configCookie("mimo", ["MIMO_COOKIE"]);
  if (!cookie) {
    return unauth("mimo", "missing MIMO_COOKIE (api-platform_serviceToken + userId cookies)");
  }
  if (!cookie.includes("api-platform_serviceToken=")) {
    return unauth("mimo", "MIMO_COOKIE must contain api-platform_serviceToken and userId cookies");
  }
  const base = (envFirst(["MIMO_API_URL"]) ?? "https://platform.xiaomimimo.com/api/v1").replace(/\/$/, "");
  const headers: Record<string, string> = {
    Cookie: cookie,
    Origin: "https://platform.xiaomimimo.com",
    Referer: "https://platform.xiaomimimo.com/",
    "x-timeZone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    "User-Agent": CHROME_UA,
  };
  const windows: ProviderUsageWindow[] = [];
  const usage = await httpGet(`${base}/tokenPlan/usage`, headers);
  if (usage.ok) {
    const month = asRec(deepFind(usage.json, "monthUsage"));
    const item = asRec(Array.isArray(month.items) ? month.items[0] : null);
    const used = pickNum(item, "used");
    const limit = pickNum(item, "limit");
    const pctRaw = pickNum(item, "percent");
    const pct = pctRaw !== null ? (pctRaw <= 1 ? pctRaw * 100 : pctRaw) : percentUsed(used, limit);
    const win = windowOf("monthly", "month", pct);
    if (win) windows.push(win);
  } else if (usage.status === 401 || usage.status === 403) {
    return mapHttpFailure("mimo", usage);
  }
  const bal = await httpGet(`${base}/balance`, headers);
  if (bal.ok) {
    const data = asRec(asRec(bal.json).data ?? bal.json);
    const balance = pickString(data, "balance") ?? String(pickNum(data, "balance") ?? "");
    const currency = pickString(data, "currency") ?? "";
    if (balance) windows.push(detailWindow("balance", "bal", `${balance}${currency ? ` ${currency}` : ""}`));
  }
  if (windows.length === 0) return errSnap("mimo", "no tokenPlan usage or balance in response");
  return snapshotOk("mimo", windows);
}

async function fetchDoubao(): Promise<ProviderUsageSnapshot> {
  // DoubaoUsageFetcher: minimal (paid) chat-completions probe purely for the
  // x-ratelimit-* RESPONSE HEADERS; tries CodexBar's model candidates in
  // order. Unreliable limits → omit the gauge (never fake 0%). The SigV4
  // coding-plan quota path is not ported.
  const key = configApiKey("doubao", ["ARK_API_KEY", "VOLCENGINE_API_KEY", "DOUBAO_API_KEY"]);
  if (!key) return unauth("doubao", "missing ARK_API_KEY / DOUBAO_API_KEY");
  const models = [
    envFirst(["DOUBAO_MODEL"]),
    "doubao-seed-2.0-code",
    "doubao-1.5-pro-32k",
    "doubao-lite-32k",
  ].filter((m): m is string => !!m);
  let last: ProviderUsageSnapshot | null = null;
  for (const model of models) {
    const res = await httpPost(
      "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
      { Authorization: `Bearer ${key}` },
      JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    );
    // DoubaoUsageFetcher accepts 200 AND 429 — a throttled response still
    // carries the limit headers (429 needs only the limit to be reliable).
    const is429 = !res.ok && res.status === 429;
    if (!res.ok && !is429) {
      last = mapHttpFailure("doubao", res);
      if (res.status === 401 || res.status === 403) return last;
      continue;
    }
    const limit = num(res.headers["x-ratelimit-limit-requests"]);
    const remaining = num(res.headers["x-ratelimit-remaining-requests"]);
    const reset = res.headers["x-ratelimit-reset-requests"];
    const reliable = is429 ? limit !== null : limit !== null && remaining !== null;
    if (reliable && limit !== null && limit > 0) {
      const used = Math.max(0, limit - (remaining ?? 0));
      return usedLimitWindows("doubao", [
        {
          id: "requests",
          label: "req",
          used,
          limit,
          resetsAt: isoFromIso(reset) ?? isoFromSecOrMs(reset),
        },
      ]);
    }
    if (is429) return emptyProviderSnapshot("doubao", "rate_limited", "HTTP 429 without limit headers");
    // Key works but the limiter headers are unreliable — honest text, no gauge.
    return snapshotOk("doubao", [detailWindow("api", "api", "key ok, no quota headers")]);
  }
  return last ?? errSnap("doubao", "no Doubao model accepted the probe");
}

async function fetchSakana(): Promise<ProviderUsageSnapshot> {
  // SakanaUsageFetcher: HTML billing page scrape — split <p> structure
  // (<p>5-hour</p> … <p>N% used</p>). A page without those markers is a
  // failure (likely the login page), never a fake-healthy window.
  const cookie = configCookie("sakana", ["SAKANA_COOKIE"]);
  if (!cookie) return unauth("sakana", "missing SAKANA_COOKIE (browser session)");
  const res = await httpGet("https://console.sakana.ai/billing", {
    Cookie: cookie,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": CHROME_UA,
  });
  if (!res.ok) return mapHttpFailure("sakana", res);
  const text = res.text;
  const scrape = (marker: string): number | null => {
    const re = new RegExp(
      `<p[^>]*>\\s*${marker}\\s*</p>[\\s\\S]{0,400}?<p[^>]*>\\s*(\\d+(?:\\.\\d+)?)\\s*%\\s*used\\s*</p>`,
      "i",
    );
    const m = text.match(re);
    return m?.[1] != null ? Number(m[1]) : null;
  };
  const session = scrape("5-hour");
  const weekly = scrape("Weekly");
  if (session === null && weekly === null) {
    if (/sign\s*in|log\s*in/i.test(text)) return unauth("sakana", "billing page redirected to login");
    return errSnap("sakana", "billing page had no usage markers");
  }
  return usedLimitWindows("sakana", [
    { id: "session", label: "session", utilization: session },
    { id: "weekly", label: "week", utilization: weekly },
  ]);
}

async function fetchAbacus(): Promise<ProviderUsageSnapshot> {
  // AbacusUsageFetcher: {success, result:{totalComputePoints, computePointsLeft}}.
  return cookieProvider(
    "abacus",
    ["ABACUS_COOKIE"],
    "https://apps.abacus.ai/api/_getOrganizationComputePoints",
    (json) => {
      const root = asRec(json);
      if (root.success !== true) {
        return errSnap("abacus", "compute points request unsuccessful");
      }
      const result = asRec(root.result);
      const total = pickNum(result, "totalComputePoints");
      const left = pickNum(result, "computePointsLeft");
      if (total === null || left === null || total <= 0) {
        return errSnap("abacus", "missing totalComputePoints/computePointsLeft");
      }
      return usedLimitWindows("abacus", [
        { id: "compute", label: "pts", used: total - left, limit: total },
      ]);
    },
  );
}

// CommandCodePlanCatalog: planId → monthly USD allowance.
const COMMANDCODE_PLANS: Record<string, number> = {
  "individual-go": 10,
  "individual-pro": 30,
  "individual-max": 150,
  "individual-ultra": 300,
};

async function fetchCommandCode(): Promise<ProviderUsageSnapshot> {
  // CommandCodeUsageFetcher: GET /internal/billing/credits (+ best-effort
  // /internal/billing/subscriptions for the plan limit). monthlyCredits is
  // REMAINING USD; plan catalog supplies the monthly total.
  const cookie = configCookie(
    "commandcode",
    ["COMMANDCODE_COOKIE", "COMMAND_CODE_COOKIE"],
    "__Secure-better-auth.session_token",
  );
  if (!cookie) return unauth("commandcode", "missing COMMANDCODE_COOKIE (browser session)");
  const headers = {
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://commandcode.ai",
    Referer: "https://commandcode.ai/",
    "User-Agent": CHROME_UA,
  };
  const res = await httpGet("https://api.commandcode.ai/internal/billing/credits", headers);
  if (!res.ok) return mapHttpFailure("commandcode", res);
  const credits = asRec(asRec(res.json).credits ?? res.json);
  const monthly = pickNum(credits, "monthlyCredits", "monthly_credits");
  const purchased = pickNum(credits, "purchasedCredits", "purchased_credits");
  const premium = pickNum(credits, "premiumMonthlyCredits", "premium_monthly_credits");
  if (monthly === null) return errSnap("commandcode", "no credits fields in response");

  // Best-effort plan lookup for a real percent window.
  let planLimit: number | null = null;
  let resetsAt: string | null = null;
  const subs = await httpGet("https://api.commandcode.ai/internal/billing/subscriptions", headers);
  if (subs.ok) {
    const subsRoot = asRec(subs.json);
    const data = asRec(subsRoot.data);
    const planId = pickString(data, "planId", "plan_id")?.toLowerCase();
    if (planId && COMMANDCODE_PLANS[planId] !== undefined) planLimit = COMMANDCODE_PLANS[planId]!;
    resetsAt = isoFromIso(data.currentPeriodEnd ?? data.current_period_end);
  }
  const windows: ProviderUsageWindow[] = [];
  if (planLimit !== null && planLimit > 0) {
    const used = Math.max(0, Math.min(planLimit, planLimit - monthly));
    const win = windowOf("monthly", "month", (used / planLimit) * 100, resetsAt);
    if (win) windows.push(win);
  } else {
    windows.push(detailWindow("monthly", "month", `$${formatAmount(monthly)} left`, resetsAt));
  }
  if (premium !== null && premium > 0) {
    windows.push(detailWindow("premium", "premium", `$${formatAmount(premium)} left`));
  }
  if (purchased !== null && purchased > 0) {
    windows.push(detailWindow("purchased", "extra", `$${formatAmount(purchased)}`));
  }
  return snapshotOk("commandcode", windows);
}

async function fetchQoder(): Promise<ProviderUsageSnapshot> {
  // QoderUsageFetcher: browser-gated (X-Requested-With + Bx-V headers);
  // values nested at totalQuota.quotaSummary (+ optional sharedQuota merge).
  const cookie = configCookie("qoder", ["QODER_COOKIE"]);
  if (!cookie) return unauth("qoder", "missing QODER_COOKIE (browser session)");
  const res = await httpGet("https://qoder.com/api/v2/me/usages/big_model_credits", {
    Cookie: cookie,
    "X-Requested-With": "XMLHttpRequest",
    "Bx-V": "2.5.35",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://qoder.com",
    Referer: "https://qoder.com/account/usage",
    "User-Agent": CHROME_UA,
  });
  if (!res.ok) return mapHttpFailure("qoder", res);
  const root = asRec(res.json);
  const data = asRec(root.data ?? root);
  const summary = (camel: string, snake: string) =>
    asRec(asRec(data[camel] ?? data[snake]).quotaSummary ?? asRec(data[camel] ?? data[snake]).quota_summary);
  const total = summary("totalQuota", "total_quota");
  const shared = summary("sharedQuota", "shared_quota");
  let used = pickNum(total, "usedValue", "used_value");
  let limit = pickNum(total, "limitValue", "limit_value");
  const sharedUsed = pickNum(shared, "usedValue", "used_value");
  const sharedLimit = pickNum(shared, "limitValue", "limit_value");
  if (sharedUsed !== null) used = (used ?? 0) + sharedUsed;
  if (sharedLimit !== null) limit = (limit ?? 0) + sharedLimit;
  const pct = pickNum(total, "usagePercentage", "usage_percentage");
  const reset = data.nextResetAt ?? data.next_reset_at;
  const resetsAt = isoFromIso(reset) ?? isoFromSecOrMs(reset);
  return usedLimitWindows("qoder", [
    { id: "credits", label: "credits", used, limit, utilization: used !== null && limit !== null && limit > 0 ? null : pct, resetsAt },
  ]);
}

async function fetchStepFun(): Promise<ProviderUsageSnapshot> {
  // StepFunUsageFetcher: Oasis-Token cookie + oasis-* headers; success gate
  // `status == 1`; *_left_rate fields are remaining fractions (0..1).
  const token =
    envFirst(["STEPFUN_TOKEN"]) ??
    configApiKey("stepfun", ["STEPFUN_TOKEN", "STEPFUN_API_KEY"]) ??
    configCookie("stepfun", ["STEPFUN_COOKIE"]);
  if (!token) {
    return unauth("stepfun", "missing STEPFUN_TOKEN (Oasis token; password login not ported)");
  }
  const oasis = token.includes("Oasis-Token=")
    ? token
    : token.includes("=")
      ? token
      : `Oasis-Token=${token}`;
  const webId = oasis.match(/(?:^|;\s*)Oasis-Webid=([^;]+)/i)?.[1] ?? envFirst(["STEPFUN_WEBID"]);
  const headers: Record<string, string> = {
    Cookie: webId && !oasis.includes("Oasis-Webid=") ? `${oasis}; Oasis-Webid=${webId}` : oasis,
    "Content-Type": "application/json",
    "oasis-appid": "10300",
    "oasis-platform": "web",
    Origin: "https://platform.stepfun.com",
    Referer: "https://platform.stepfun.com/",
    "User-Agent": CHROME_UA,
  };
  if (webId) headers["oasis-webid"] = webId;
  const res = await httpPost(
    "https://platform.stepfun.com/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit",
    headers,
    "{}",
  );
  if (!res.ok) return mapHttpFailure("stepfun", res);
  const root = asRec(res.json);
  const status = pickNum(root, "status");
  if (status !== null && status !== 1) {
    return errSnap("stepfun", `dashboard RPC returned status ${status}`);
  }
  const fiveLeft = pickNum(root, "five_hour_usage_left_rate", "fiveHourUsageLeftRate");
  const weekLeft = pickNum(root, "weekly_usage_left_rate", "weeklyUsageLeftRate");
  return usedLimitWindows("stepfun", [
    {
      id: "session",
      label: "session",
      utilization: percentFromRemaining(fiveLeft),
      resetsAt: isoFromIso(root.five_hour_usage_reset_time) ?? isoFromSecOrMs(root.five_hour_usage_reset_time),
    },
    {
      id: "weekly",
      label: "week",
      utilization: percentFromRemaining(weekLeft),
      resetsAt: isoFromIso(root.weekly_usage_reset_time) ?? isoFromSecOrMs(root.weekly_usage_reset_time),
    },
  ]);
}

async function fetchAlibaba(): Promise<ProviderUsageSnapshot> {
  // AlibabaCodingPlanUsageFetcher: the DashScope path POSTs a signed
  // queryCodingPlanInstanceInfoV2 RPC and the console path needs a scraped
  // sec_token + CSRF form POST — both beyond this port's web-scrape tier.
  // Resolve credentials honestly and report the gap instead of probing
  // invented endpoints.
  const key = configApiKey("alibaba", ["ALIBABA_CODING_PLAN_API_KEY", "DASHSCOPE_API_KEY"]);
  const cookie = configCookie("alibaba", ["ALIBABA_CODING_PLAN_COOKIE", "ALIBABA_COOKIE"]);
  if (!key && !cookie) {
    return unauth("alibaba", "missing ALIBABA_CODING_PLAN_API_KEY / DASHSCOPE_API_KEY / console cookie");
  }
  return errSnap(
    "alibaba",
    "Alibaba coding-plan quota needs the signed console RPC (sec_token + CSRF); not supported by this port",
  );
}

async function fetchAlibabaTokenPlan(): Promise<ProviderUsageSnapshot> {
  // AlibabaTokenPlanUsageFetcher: GetSubscriptionSummary is a sec_token +
  // CSRF form POST on the console — same unported tier as the coding plan.
  const cookie = configCookie("alibabatokenplan", ["ALIBABA_TOKEN_PLAN_COOKIE", "ALIBABA_COOKIE"]);
  if (!cookie) return unauth("alibabatokenplan", "missing ALIBABA_TOKEN_PLAN_COOKIE (console session)");
  return errSnap(
    "alibabatokenplan",
    "Alibaba token-plan quota needs the signed console RPC (sec_token + CSRF); not supported by this port",
  );
}

async function fetchAugment(): Promise<ProviderUsageSnapshot> {
  // AugmentStatusProbe: GET /api/credits → usageUnits* fields;
  // limit = usageUnitsAvailable, else remaining + consumed.
  return cookieProvider(
    "augment",
    ["AUGMENT_COOKIE"],
    "https://app.augmentcode.com/api/credits",
    (json) => {
      const root = asRec(json);
      const remaining = pickNum(root, "usageUnitsRemaining");
      const consumed = pickNum(root, "usageUnitsConsumedThisBillingCycle");
      const available = pickNum(root, "usageUnitsAvailable");
      const limit =
        available ?? (remaining !== null && consumed !== null ? remaining + consumed : null);
      return usedLimitWindows("augment", [
        { id: "credits", label: "credits", used: consumed, limit, remaining, unit: "units" },
      ]);
    },
  );
}

async function fetchGrok(): Promise<ProviderUsageSnapshot> {
  // CodexBar's Grok sources are the grok CLI JSON-RPC (`x.ai/billing`) and a
  // gRPC-web protobuf endpoint — neither speaks plain JSON, so this port does
  // not fetch usage. It resolves credentials honestly: a valid ~/.grok/auth.json
  // entry (map keyed by scope URL; prefer the OIDC scope, respect expiry)
  // reports the protocol gap; anything else is unauthenticated. CodexBar
  // likewise never projects ~/.grok/sessions into a usage window.
  const auth = readJsonHome(".grok", "auth.json");
  let token: string | null = null;
  if (auth) {
    const entries = Object.entries(auth)
      .filter(([, v]) => v && typeof v === "object")
      .sort(([a], [b]) => {
        const rank = (k: string) => (k.includes("auth.x.ai") ? 0 : 1);
        return rank(a) - rank(b);
      });
    for (const [, v] of entries) {
      const entry = v as Record<string, unknown>;
      const expires = num(entry.expires_at ?? entry.expiresAt);
      if (expires !== null && expires * (expires > 1e12 ? 1 : 1000) < Date.now()) continue;
      token = pickString(entry, "key", "access_token", "token");
      if (token) break;
    }
    token ??= pickString(auth, "key", "access_token", "token");
  }
  if (!token) return unauth("grok", "missing ~/.grok/auth.json (run `grok` and sign in)");
  return errSnap(
    "grok",
    "Grok billing requires the grok CLI JSON-RPC or gRPC-web protobuf endpoint; not supported by this port",
  );
}

async function fetchBedrock(): Promise<ProviderUsageSnapshot> {
  const access = envFirst(["AWS_ACCESS_KEY_ID"]);
  const secret = envFirst(["AWS_SECRET_ACCESS_KEY"]);
  const profile = envFirst(["AWS_PROFILE"]);
  if (!access && !profile) {
    return unauth("bedrock", "missing AWS_ACCESS_KEY_ID or AWS_PROFILE");
  }
  if (access && !secret) return unauth("bedrock", "missing AWS_SECRET_ACCESS_KEY");
  const budget = num(envFirst(["CODEXBAR_BEDROCK_BUDGET", "BEDROCK_BUDGET"]));
  // Optional CodexBar-compatible override: CODEXBAR_BEDROCK_API_URL points at
  // a cost endpoint/mock returning spend JSON.
  const costUrl = envFirst(["CODEXBAR_BEDROCK_API_URL"]);
  if (costUrl) {
    const res = await httpGet(costUrl, {});
    if (!res.ok) return mapHttpFailure("bedrock", res);
    const root = asRec(res.json);
    const spend = pickNum(root, "spend", "amount", "BlendedCost");
    return usedLimitWindows("bedrock", [
      { id: "month", label: "month", used: spend, limit: budget, utilization: percentUsed(spend, budget), unit: "USD" },
    ]);
  }
  // Cost Explorer needs an AWS SigV4 client — not ported. Credentials exist,
  // so this is a capability gap, not a login problem.
  return errSnap("bedrock", "Bedrock spend needs AWS Cost Explorer (SigV4); set CODEXBAR_BEDROCK_API_URL or use the AWS console");
}

async function fetchVertexAI(): Promise<ProviderUsageSnapshot> {
  // ADC file probe
  const adc =
    readJsonHome(".config", "gcloud", "application_default_credentials.json") ??
    (() => {
      const p = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
      if (!p) return null;
      try {
        const raw = fs.readFileSync(p, "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    })();
  if (!adc) return unauth("vertexai", "missing Google ADC (~/.config/gcloud/application_default_credentials.json)");
  const token = pickString(adc, "access_token", "accessToken", "token");
  // Refresh tokens alone mean we have credentials but may need refresh — still not unauthenticated.
  const refresh = pickString(adc, "refresh_token", "refreshToken");
  if (!token && !refresh) return unauth("vertexai", "ADC file missing tokens");
  // Quota metrics need a live access token + Cloud Monitoring time-series
  // parsing (and usually a token refresh) — not ported. Credentials exist,
  // so report the gap rather than a fake-healthy gauge.
  return errSnap(
    "vertexai",
    "Vertex AI quota needs Cloud Monitoring metrics with a refreshed ADC token; not supported by this port",
  );
}

async function fetchKiro(): Promise<ProviderUsageSnapshot> {
  // CodexBar drives the kiro CLI for quota — the CLI probe is not ported.
  const auth =
    readJsonHome(".kiro", "auth.json") ??
    readJsonHome(".config", "kiro", "auth.json") ??
    readJsonHome(".kiro", "settings.json");
  if (!auth) return unauth("kiro", "missing kiro auth (run kiro-cli login)");
  return errSnap("kiro", "Kiro quota is read via the kiro CLI; not supported by this port");
}

// ── Local probes ────────────────────────────────────────────────────────────

async function fetchGemini(): Promise<ProviderUsageSnapshot> {
  const creds =
    readJsonHome(".gemini", "oauth_creds.json") ??
    readJsonHome(".config", "gemini", "oauth_creds.json") ??
    readJsonHome(".gemini", "credentials.json");
  if (!creds) return unauth("gemini", "missing ~/.gemini/oauth_creds.json");
  let access =
    pickString(creds, "access_token", "accessToken", "token") ??
    pickString(asRec(creds.tokens), "access_token", "accessToken");
  const refresh =
    pickString(creds, "refresh_token", "refreshToken") ??
    pickString(asRec(creds.tokens), "refresh_token", "refreshToken");
  if (!access && refresh) {
    // Best-effort refresh via Google OAuth is not ported (gemini-cli client id
    // not embedded) — an expired access token means we genuinely can't fetch.
    return unauth("gemini", "gemini access token expired — run the gemini CLI once to refresh it");
  }
  if (!access) return unauth("gemini", "gemini oauth creds missing access_token");
  const res = await httpPost(
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    { Authorization: `Bearer ${access}` },
    JSON.stringify({}),
  );
  if (!res.ok) return mapHttpFailure("gemini", res);
  const root = asRec(res.json);
  const windows: ProviderUsageWindow[] = [];
  const buckets = Array.isArray(root.buckets)
    ? root.buckets
    : Array.isArray(root.quotas)
      ? root.quotas
      : [root];
  for (const raw of buckets) {
    const b = asRec(raw);
    const util =
      pickNum(b, "utilization", "used_percent", "usedPercent") ??
      percentFromRemaining(pickNum(b, "remainingFraction", "remaining_fraction")) ??
      percentUsed(pickNum(b, "used"), pickNum(b, "limit", "quota"));
    const name = String(b.name ?? b.id ?? b.model ?? "quota");
    const win = windowOf(name, name.slice(0, 12), util, isoFromIso(b.resetTime ?? b.resets_at));
    if (win) windows.push(win);
  }
  if (windows.length === 0) return errSnap("gemini", "no quota buckets in retrieveUserQuota response");
  return snapshotOk("gemini", windows.slice(0, 6));
}

async function fetchAntigravity(): Promise<ProviderUsageSnapshot> {
  // Keep probe set small — sequential localhost timeouts add up quickly.
  const candidates = [
    "http://127.0.0.1:7242",
    "https://127.0.0.1:7242",
    "http://127.0.0.1:4500",
  ];
  let reachable: string | null = null;
  for (const base of candidates) {
    for (const pathSuffix of ["/healthz", "/health"]) {
      const res = await httpGet(`${base}${pathSuffix}`, {}, 800);
      if (res.ok && res.json) {
        const root = asRec(res.json);
        const util =
          pickNum(root, "utilization", "used_percent") ??
          percentFromRemaining(pickNum(root, "remainingFraction", "remaining_fraction"));
        if (util !== null) {
          return snapshotOk("antigravity", [
            { id: "local", label: "local", utilization: util, resetsAt: null },
          ]);
        }
      }
      if (res.ok || res.status === 404 || res.status === 401) reachable = base;
    }
  }
  if (reachable) {
    return errSnap("antigravity", `local Antigravity server at ${reachable} exposes no usage data`);
  }
  return unauth("antigravity", "no local Antigravity server / oauth creds");
}

async function fetchJetBrains(): Promise<ProviderUsageSnapshot> {
  const home = os.homedir();
  const roots: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    roots.push(path.join(appData, "JetBrains"), path.join(local, "JetBrains"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "JetBrains"));
  } else {
    roots.push(path.join(home, ".config", "JetBrains"), path.join(home, ".local", "share", "JetBrains"));
  }

  const xmlFiles: { file: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.isFile() && /AIAssistantQuotaManager2\.xml$/i.test(ent.name)) {
        try {
          xmlFiles.push({ file: full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          /* skip */
        }
      }
    }
  };
  for (const r of roots) {
    if (fs.existsSync(r)) walk(r, 0);
  }
  xmlFiles.sort((a, b) => b.mtime - a.mtime);
  const best = xmlFiles[0];
  if (!best) return unauth("jetbrains", "AIAssistantQuotaManager2.xml not found");

  let xml: string;
  try {
    xml = fs.readFileSync(best.file, "utf8");
  } catch (e) {
    return errSnap("jetbrains", e instanceof Error ? e.message : "read failed");
  }

  // JetBrainsStatusProbe: option values are HTML-entity-escaped JSON blobs —
  // quotaInfo {type, current, maximum, until, tariffQuota:{available}} and
  // nextRefill {next, …}; numbers are string-typed.
  const optionValue = (name: string): Record<string, unknown> | null => {
    const m = xml.match(new RegExp(`<option\\s+name="${name}"\\s+value="([^"]*)"`, "i"));
    if (!m?.[1]) return null;
    const decoded = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&apos;/g, "'");
    try {
      const parsed = JSON.parse(decoded);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const quotaInfo = optionValue("quotaInfo");
  if (!quotaInfo) return errSnap("jetbrains", "no quotaInfo option in AIAssistantQuotaManager2.xml");
  const used = num(quotaInfo.current);
  const maximum = num(quotaInfo.maximum);
  const refill = optionValue("nextRefill");
  const resetsAt =
    isoFromIso(refill?.next) ?? isoFromIso(quotaInfo.until) ?? null;
  return usedLimitWindows("jetbrains", [
    { id: "quota", label: "quota", used, limit: maximum, resetsAt },
  ]);
}

async function fetchWayfinder(): Promise<ProviderUsageSnapshot> {
  const configured =
    envFirst(["WAYFINDER_GATEWAY_URL"]) ?? configEnterpriseHost("wayfinder") ?? "http://127.0.0.1:8088";
  let base = configured.replace(/\/$/, "");
  if (!base.startsWith("http")) base = `http://${base}`;
  const health = await httpGet(`${base}/healthz`, {}, 2000);
  if (!health.ok && health.status === 0) {
    return unauth("wayfinder", `gateway unreachable at ${base}`);
  }
  // Unauthenticated loopback is expected; treat reachable gateway as ok.
  const savings = await httpGet(`${base}/v1/savings?period=30d`, {}, 3000);
  const models = await httpGet(`${base}/router/models`, {}, 3000);
  const note: string[] = [];
  if (health.ok) note.push("healthy");
  if (savings.ok) note.push("savings");
  if (models.ok) note.push("models");
  if (!health.ok && !savings.ok && !models.ok) {
    return errSnap("wayfinder", `gateway ${base} returned errors`);
  }
  // A local gateway has no quota — "healthy" is its honest state.
  return snapshotOk("wayfinder", [detailWindow("gateway", "gw", note.join(", ") || "healthy")]);
}

async function fetchOllama(): Promise<ProviderUsageSnapshot> {
  // Local Ollama has no quota — the honest state is model availability.
  const local = await httpGet("http://127.0.0.1:11434/api/tags", {}, 2000);
  if (local.ok) {
    const root = asRec(local.json);
    const models = Array.isArray(root.models) ? root.models.length : 0;
    return snapshotOk("ollama", [detailWindow("local", "local", `${models} models`)]);
  }
  const key = configApiKey("ollama", ["OLLAMA_API_KEY"]);
  if (key) {
    const res = await bearerJson("ollama", "https://ollama.com/api/tags", key);
    if (!res.ok) return res.snap;
    return snapshotOk("ollama", [detailWindow("cloud", "cloud", "key ok")]);
  }
  return unauth("ollama", "ollama not running locally and no OLLAMA_API_KEY");
}

function readZedKeychainCredentials(): { userId: string; token: string } | null {
  // ZedKeychainCredentialsReader: internet-password item for https://zed.dev —
  // account = user id, password = access token. macOS only.
  if (process.platform !== "darwin") return null;
  try {
    const password = execFileSync(
      "security",
      ["find-internet-password", "-s", "zed.dev", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).replace(/\r?\n$/, "");
    const meta = execFileSync("security", ["find-internet-password", "-s", "zed.dev"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const account = meta.match(/"acct"<blob>="([^"]+)"/)?.[1];
    if (!password || !account) return null;
    return { userId: account, token: password };
  } catch {
    return null;
  }
}

async function fetchZed(): Promise<ProviderUsageSnapshot> {
  // ZedStatusProbe: GET cloud.zed.dev/client/users/me with
  // `Authorization: <userID> <accessToken>` (not Bearer). Response:
  // plan.usage.edit_predictions {used, limit: int | "unlimited"},
  // plan.subscription_period.ended_at, plan.plan_v3.
  let userId = envFirst(["ZED_USER_ID"]);
  let token = configApiKey("zed", ["ZED_API_TOKEN", "ZED_TOKEN"]);
  if (token?.includes(" ") && !userId) {
    const [id, ...rest] = token.split(" ");
    userId = id ?? null;
    token = rest.join(" ") || null;
  }
  if (!userId || !token) {
    const kc = readZedKeychainCredentials();
    if (kc) {
      userId = kc.userId;
      token = kc.token;
    }
  }
  if (!userId || !token) {
    return unauth(
      "zed",
      process.platform === "darwin"
        ? "missing Zed keychain credentials / ZED_USER_ID + ZED_API_TOKEN"
        : "missing ZED_USER_ID + ZED_API_TOKEN (Zed keychain is macOS-only)",
    );
  }
  const res = await httpGet("https://cloud.zed.dev/client/users/me", {
    Authorization: `${userId} ${token}`,
  });
  if (!res.ok) return mapHttpFailure("zed", res);
  const root = asRec(res.json);
  const plan = asRec(root.plan);
  const edit = asRec(asRec(plan.usage).edit_predictions);
  const resetsAt = isoFromIso(asRec(plan.subscription_period).ended_at);
  const planName = pickString(plan, "plan_v3") ?? "plan";
  const used = pickNum(edit, "used");
  const rawLimit = edit.limit;
  const limit = num(rawLimit) ?? num(asRec(rawLimit).limited);
  const windows: ProviderUsageWindow[] = [];
  if (rawLimit === "unlimited") {
    windows.push(detailWindow("edit", "edit", "unlimited", resetsAt));
  } else {
    const win = windowOf("edit", "edit", percentUsed(used, limit), resetsAt);
    if (win) windows.push(win);
  }
  windows.push(detailWindow("plan", "plan", planName.replace(/^zed_/, ""), resetsAt));
  return snapshotOk("zed", windows);
}

// ── dispatcher ──────────────────────────────────────────────────────────────

export async function fetchProviderUsage(id: ProviderUsageId): Promise<ProviderUsageSnapshot> {
  try {
    switch (id) {
      case "claude":
        return await fetchClaude();
      case "codex":
        return await getCodexUsage();
      case "cursor":
        return await getCursorUsage();
      case "openai":
        return await fetchOpenAI();
      case "azureopenai":
        return await fetchAzureOpenAI();
      case "opencode":
        return await fetchOpenCode();
      case "opencodego":
        return await fetchOpenCodeGo();
      case "alibaba":
        return await fetchAlibaba();
      case "alibabatokenplan":
        return await fetchAlibabaTokenPlan();
      case "factory":
        return await fetchFactory();
      case "gemini":
        return await fetchGemini();
      case "antigravity":
        return await fetchAntigravity();
      case "copilot":
        return await fetchCopilot();
      case "devin":
        return await fetchDevin();
      case "zai":
        return await fetchZai();
      case "minimax":
        return await fetchMinimax();
      case "manus":
        return await fetchManus();
      case "kimi":
        return await fetchKimi();
      case "kilo":
        return await fetchKilo();
      case "kiro":
        return await fetchKiro();
      case "vertexai":
        return await fetchVertexAI();
      case "augment":
        return await fetchAugment();
      case "jetbrains":
        return await fetchJetBrains();
      case "kimik2":
        return await fetchKimiK2();
      case "moonshot":
        return await fetchMoonshot();
      case "amp":
        return await fetchAmp();
      case "t3chat":
        return await fetchT3Chat();
      case "ollama":
        return await fetchOllama();
      case "synthetic":
        return await fetchSynthetic();
      case "warp":
        return await fetchWarp();
      case "openrouter":
        return await fetchOpenRouter();
      case "elevenlabs":
        return await fetchElevenLabs();
      case "windsurf":
        return await fetchWindsurf();
      case "zed":
        return await fetchZed();
      case "perplexity":
        return await fetchPerplexity();
      case "mimo":
        return await fetchMimo();
      case "doubao":
        return await fetchDoubao();
      case "sakana":
        return await fetchSakana();
      case "abacus":
        return await fetchAbacus();
      case "mistral":
        return await fetchMistral();
      case "deepseek":
        return await fetchDeepSeek();
      case "codebuff":
        return await fetchCodebuff();
      case "crof":
        return await fetchCrof();
      case "venice":
        return await fetchVenice();
      case "commandcode":
        return await fetchCommandCode();
      case "qoder":
        return await fetchQoder();
      case "stepfun":
        return await fetchStepFun();
      case "bedrock":
        return await fetchBedrock();
      case "grok":
        return await fetchGrok();
      case "groq":
        return await fetchGroq();
      case "llmproxy":
        return await fetchLlmProxy();
      case "litellm":
        return await fetchLiteLlm();
      case "deepgram":
        return await fetchDeepgram();
      case "poe":
        return await fetchPoe();
      case "chutes":
        return await fetchChutes();
      case "crossmodel":
        return await fetchCrossModel();
      case "clawrouter":
        return await fetchClawRouter();
      case "wayfinder":
        return await fetchWayfinder();
      default: {
        // Exhaustiveness: if a new id is added to the catalog, TypeScript should error above.
        const _exhaustive: never = id;
        return emptyProviderSnapshot(_exhaustive, "error", "unknown provider id");
      }
    }
  } catch (err) {
    return emptyProviderSnapshot(
      id,
      "error",
      err instanceof Error ? err.message : "provider fetch failed",
    );
  }
}
