/**
 * Pure normalize helpers for provider usage payloads.
 * Free of Electron/UI and credential I/O so unit tests drive them with fixtures.
 */

import type {
  ProviderUsageId,
  ProviderUsageSnapshot,
  ProviderUsageStatus,
  ProviderUsageWindow,
} from "./provider-usage";
import { providerDisplayName } from "./provider-usage";

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isoFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const n = finiteNumber(value);
  if (n === null) return null;
  // Codex uses unix seconds for reset_at.
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function windowOf(
  id: string,
  label: string,
  utilization: number | null,
  resetsAt: string | null,
  detail?: string,
): ProviderUsageWindow | null {
  if (utilization === null && !detail) return null;
  return { id, label, utilization, resetsAt, ...(detail ? { detail } : {}) };
}

/** Compact human amount for meterless balance windows. */
export function formatAmount(value: number, unit?: string): string {
  const s = Number.isInteger(value)
    ? String(value)
    : Math.abs(value) >= 100
      ? value.toFixed(0)
      : value.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

/**
 * Claude OAuth / statusline-tap shape:
 * `{ five_hour, seven_day, seven_day_opus }` each `{ utilization, resets_at }`.
 */
export function normalizeClaudeUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number; status?: ProviderUsageStatus; error?: string },
): ProviderUsageSnapshot {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const parseBucket = (bucket: unknown): { utilization: number; resetsAt: string | null } | null => {
    if (!bucket || typeof bucket !== "object") return null;
    const o = bucket as { utilization?: unknown; resets_at?: unknown; resetsAt?: unknown };
    const utilization = finiteNumber(o.utilization);
    if (utilization === null) return null;
    return {
      utilization,
      resetsAt: isoFromUnknown(o.resets_at ?? o.resetsAt),
    };
  };

  const session = parseBucket(b.five_hour);
  const weekly = parseBucket(b.seven_day);
  // Model-scoped weekly slot — CodexBar prefers seven_day_sonnet over opus.
  const sonnet = parseBucket(b.seven_day_sonnet);
  const weeklyOpus = sonnet ?? parseBucket(b.seven_day_opus);
  const modelLabel = sonnet ? "sonnet" : "opus";
  const windows: ProviderUsageWindow[] = [];
  if (session) {
    windows.push({ id: "session", label: "session", utilization: session.utilization, resetsAt: session.resetsAt });
  }
  if (weekly) {
    windows.push({ id: "weekly", label: "week", utilization: weekly.utilization, resetsAt: weekly.resetsAt });
  }
  if (weeklyOpus) {
    windows.push({
      id: "weeklyOpus",
      label: modelLabel,
      utilization: weeklyOpus.utilization,
      resetsAt: weeklyOpus.resetsAt,
    });
  }

  return {
    id: "claude",
    displayName: providerDisplayName("claude"),
    status: opts?.status ?? (windows.length > 0 ? "ok" : "error"),
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(opts?.error ? { error: opts.error } : {}),
  };
}

/**
 * Codex `wham/usage` rate_limit windows:
 * `rate_limit.primary_window` / `secondary_window` with
 * `used_percent`, `reset_at` (unix s), `limit_window_seconds`.
 */
export function normalizeCodexUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number; status?: ProviderUsageStatus; error?: string },
): ProviderUsageSnapshot {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rateLimit =
    b.rate_limit && typeof b.rate_limit === "object"
      ? (b.rate_limit as Record<string, unknown>)
      : b.rateLimit && typeof b.rateLimit === "object"
        ? (b.rateLimit as Record<string, unknown>)
        : {};

  const parseWindow = (
    raw: unknown,
  ): { utilization: number; resetsAt: string | null; windowMinutes: number | null } | null => {
    if (!raw || typeof raw !== "object") return null;
    const w = raw as Record<string, unknown>;
    const utilization = finiteNumber(w.used_percent ?? w.usedPercent);
    if (utilization === null) return null;
    const seconds = finiteNumber(w.limit_window_seconds ?? w.limitWindowSeconds);
    return {
      utilization,
      resetsAt: isoFromUnknown(w.reset_at ?? w.resetAt),
      windowMinutes: seconds === null ? null : Math.round(seconds / 60),
    };
  };

  let primary = parseWindow(rateLimit.primary_window ?? rateLimit.primaryWindow);
  let secondary = parseWindow(rateLimit.secondary_window ?? rateLimit.secondaryWindow);

  // Align with CodexRateWindowNormalizer: 300m = session, 10080m = weekly.
  const role = (w: { windowMinutes: number | null }) => {
    if (w.windowMinutes === 300) return "session" as const;
    if (w.windowMinutes === 10080) return "weekly" as const;
    return "unknown" as const;
  };
  if (primary && secondary) {
    const pr = role(primary);
    const sr = role(secondary);
    if (pr === "weekly" && (sr === "session" || sr === "unknown")) {
      const tmp = primary;
      primary = secondary;
      secondary = tmp;
    }
  } else if (primary && !secondary && role(primary) === "weekly") {
    secondary = primary;
    primary = null;
  } else if (!primary && secondary && role(secondary) !== "weekly") {
    // CodexRateWindowNormalizer promotes a lone secondary window to the
    // primary/session lane unless it is definitely the weekly window.
    primary = secondary;
    secondary = null;
  }

  const windows: ProviderUsageWindow[] = [];
  if (primary) {
    windows.push({
      id: "session",
      label: "session",
      utilization: primary.utilization,
      resetsAt: primary.resetsAt,
    });
  }
  if (secondary) {
    windows.push({
      id: "weekly",
      label: "week",
      utilization: secondary.utilization,
      resetsAt: secondary.resetsAt,
    });
  }

  return {
    id: "codex",
    displayName: providerDisplayName("codex"),
    status: opts?.status ?? (windows.length > 0 ? "ok" : "error"),
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(opts?.error ? { error: opts.error } : {}),
  };
}

/**
 * Cursor `usage-summary` response → plan / auto / api windows.
 * Mirrors CursorStatusProbe snapshot mapping (plan primary, auto secondary, api tertiary).
 */
export function normalizeCursorUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number; status?: ProviderUsageStatus; error?: string },
): ProviderUsageSnapshot {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rec = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const individual = rec(b.individualUsage);
  const plan = rec(individual.plan);
  const clamp = (v: number | null): number | null =>
    v === null ? null : Math.min(100, Math.max(0, v));

  const resetsAt = isoFromUnknown(b.billingCycleEnd);
  const planPct = clamp(finiteNumber(plan.totalPercentUsed));
  const autoPct = clamp(finiteNumber(plan.autoPercentUsed));
  const apiPct = clamp(finiteNumber(plan.apiPercentUsed));

  const ratioPct = (o: Record<string, unknown>): number | null => {
    const used = finiteNumber(o.used);
    const limit = finiteNumber(o.limit);
    if (used === null || limit === null || limit <= 0) return null;
    return clamp((used / limit) * 100);
  };

  // Headline plan percent — CursorStatusProbe precedence: totalPercentUsed →
  // avg(auto, api) → api alone → auto alone → plan used/limit →
  // individualUsage.overall (enterprise personal cap) → teamUsage.pooled.
  let planUtilization = planPct;
  if (planUtilization === null && autoPct !== null && apiPct !== null) {
    planUtilization = clamp((autoPct + apiPct) / 2);
  }
  if (planUtilization === null) planUtilization = apiPct ?? autoPct;
  if (planUtilization === null) planUtilization = ratioPct(plan);
  if (planUtilization === null) planUtilization = ratioPct(rec(individual.overall));
  if (planUtilization === null) planUtilization = ratioPct(rec(rec(b.teamUsage).pooled));

  const windows: ProviderUsageWindow[] = [];
  const planWin = windowOf("plan", "plan", planUtilization, resetsAt);
  if (planWin) windows.push(planWin);
  const autoWin = windowOf("auto", "auto", autoPct, resetsAt);
  if (autoWin) windows.push(autoWin);
  const apiWin = windowOf("api", "api", apiPct, resetsAt);
  if (apiWin) windows.push(apiWin);

  return {
    id: "cursor",
    displayName: providerDisplayName("cursor"),
    status: opts?.status ?? (windows.length > 0 ? "ok" : "error"),
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(opts?.error ? { error: opts.error } : {}),
  };
}

/** Map a known ClaudeUsageLimits-shaped object into the multi-provider snapshot. */
export function claudeLimitsToProviderSnapshot(limits: {
  session: { utilization: number; resetsAt: string | null } | null;
  weekly: { utilization: number; resetsAt: string | null } | null;
  weeklyOpus: { utilization: number; resetsAt: string | null } | null;
  status: string;
  fetchedAt: number;
  error?: string;
}): ProviderUsageSnapshot {
  const windows: ProviderUsageWindow[] = [];
  if (limits.session) {
    windows.push({
      id: "session",
      label: "session",
      utilization: limits.session.utilization,
      resetsAt: limits.session.resetsAt,
    });
  }
  if (limits.weekly) {
    windows.push({
      id: "weekly",
      label: "week",
      utilization: limits.weekly.utilization,
      resetsAt: limits.weekly.resetsAt,
    });
  }
  if (limits.weeklyOpus) {
    windows.push({
      id: "weeklyOpus",
      label: "opus",
      utilization: limits.weeklyOpus.utilization,
      resetsAt: limits.weeklyOpus.resetsAt,
    });
  }
  const status: ProviderUsageStatus =
    limits.status === "ok" ||
    limits.status === "unauthenticated" ||
    limits.status === "rate_limited" ||
    limits.status === "error"
      ? limits.status
      : "error";
  return {
    id: "claude",
    displayName: providerDisplayName("claude"),
    status,
    windows,
    fetchedAt: limits.fetchedAt,
    ...(limits.error ? { error: limits.error } : {}),
  };
}

/** @deprecated Prefer live adapters — kept for fixtures that assert legacy stub shape. */
export function stubProviderSnapshot(id: ProviderUsageId): ProviderUsageSnapshot {
  return {
    id,
    displayName: providerDisplayName(id),
    status: "unavailable",
    windows: [],
    fetchedAt: Date.now(),
    error: "Adapter not yet ported from CodexBar (catalog entry only)",
  };
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function nested(obj: Record<string, unknown>, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function balanceWindow(
  id: string,
  label: string,
  used: number | null,
  limit: number | null,
  remaining: number | null,
  resetsAt: string | null = null,
  unit?: string,
): ProviderUsageWindow | null {
  if (used !== null && limit !== null && limit > 0) {
    return { id, label, utilization: (used / limit) * 100, resetsAt };
  }
  if (remaining !== null && limit !== null && limit > 0) {
    return { id, label, utilization: ((limit - remaining) / limit) * 100, resetsAt };
  }
  // Balance-only: no meter exists — carry the value itself, never a fake 0%.
  if (remaining !== null) {
    return { id, label, utilization: null, resetsAt, detail: formatAmount(remaining, unit) };
  }
  if (used !== null) {
    return { id, label, utilization: null, resetsAt, detail: `${formatAmount(used, unit)} used` };
  }
  return null;
}

/** OpenRouter `/api/v1/credits` + `/api/v1/key` combined normalize. */
export function normalizeOpenRouterUsagePayload(
  creditsBody: unknown,
  keyBody?: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const creditsRoot = asRecord(creditsBody);
  const data = asRecord(nested(creditsRoot, "data") ?? creditsRoot);
  const totalCredits = finiteNumber(data.total_credits ?? data.totalCredits);
  const totalUsage = finiteNumber(data.total_usage ?? data.totalUsage);
  const remaining =
    totalCredits !== null && totalUsage !== null ? Math.max(0, totalCredits - totalUsage) : totalCredits;

  const windows: ProviderUsageWindow[] = [];
  const bal = balanceWindow("balance", "bal", totalUsage, totalCredits, remaining, null);
  if (bal) windows.push(bal);

  if (keyBody) {
    const keyRoot = asRecord(keyBody);
    const keyData = asRecord(nested(keyRoot, "data") ?? keyRoot);
    const limit = finiteNumber(keyData.limit ?? keyData.limit_remaining);
    const usage = finiteNumber(keyData.usage ?? keyData.usage_daily);
    const limitWin = balanceWindow("key", "key", usage, limit, null, null);
    if (limitWin && (usage !== null || (limit !== null && limit > 0))) windows.push(limitWin);

    for (const [field, wid, label] of [
      ["usage_daily", "day", "day"],
      ["usage_weekly", "week", "week"],
      ["usage_monthly", "month", "month"],
    ] as const) {
      const spend = finiteNumber(keyData[field]);
      if (spend !== null && spend > 0) {
        // Spend-only lanes without a hard limit — meterless detail windows.
        windows.push({
          id: wid,
          label,
          utilization: null,
          resetsAt: null,
          detail: `${formatAmount(spend)} spent`,
        });
      }
    }
  }

  return {
    id: "openrouter",
    displayName: providerDisplayName("openrouter"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no OpenRouter usage fields" } : {}),
  };
}

/** DeepSeek `GET /user/balance` → balance window. */
export function normalizeDeepSeekUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const root = asRecord(body);
  const infos = Array.isArray(root.balance_infos)
    ? root.balance_infos
    : Array.isArray(root.balanceInfos)
      ? root.balanceInfos
      : [];
  let total: number | null = null;
  let unit: string | undefined;
  for (const raw of infos) {
    if (!raw || typeof raw !== "object") continue;
    const info = raw as Record<string, unknown>;
    const currency = String(info.currency ?? "").toUpperCase();
    const t = finiteNumber(info.total_balance ?? info.totalBalance);
    if (t === null) continue;
    if (currency === "USD" || total === null) {
      total = t;
      unit = currency || undefined;
      if (currency === "USD" && t > 0) break;
    }
  }
  const windows: ProviderUsageWindow[] = [];
  const bal = balanceWindow("balance", "bal", null, null, total, null, unit);
  if (bal) {
    windows.push(bal);
  }
  return {
    id: "deepseek",
    displayName: providerDisplayName("deepseek"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no balance data" } : {}),
  };
}

/** ElevenLabs `GET /v1/user/subscription`. */
export function normalizeElevenLabsUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const root = asRecord(body);
  const used = finiteNumber(root.character_count ?? root.characterCount);
  const limit = finiteNumber(root.character_limit ?? root.characterLimit);
  const resetUnix = finiteNumber(
    root.next_character_count_reset_unix ?? root.nextCharacterCountResetUnix,
  );
  const resetsAt = resetUnix !== null ? isoFromUnknown(resetUnix) : null;
  const windows: ProviderUsageWindow[] = [];
  const chars = balanceWindow("characters", "chars", used, limit, null, resetsAt);
  if (chars) windows.push(chars);

  const voiceUsed = finiteNumber(root.voice_slots_used ?? root.voiceSlotsUsed);
  const voiceLimit = finiteNumber(root.voice_limit ?? root.voiceLimit);
  const voices = balanceWindow("voices", "voices", voiceUsed, voiceLimit, null, null);
  if (voices && voiceUsed !== null && voiceLimit !== null) windows.push(voices);

  return {
    id: "elevenlabs",
    displayName: providerDisplayName("elevenlabs"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no subscription fields" } : {}),
  };
}

/** Moonshot balance payload. */
export function normalizeMoonshotUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const root = asRecord(body);
  const data = asRecord(nested(root, "data") ?? root);
  const available = finiteNumber(data.available_balance ?? data.availableBalance);
  const windows: ProviderUsageWindow[] = [];
  const bal = balanceWindow("balance", "bal", null, null, available, null);
  if (bal) windows.push(bal);
  return {
    id: "moonshot",
    displayName: providerDisplayName("moonshot"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no balance" } : {}),
  };
}

/** Kimi K2 credits payload. */
export function normalizeKimiK2UsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const root = asRecord(body);
  const consumed = finiteNumber(
    root.total_credits_consumed ?? root.total_credits_used ?? root.consumed ?? root.used,
  );
  const remaining = finiteNumber(
    root.credits_remaining ??
      root.creditsRemaining ??
      root.remaining_credits ??
      root.remainingCredits ??
      root.remaining,
  );
  const limit =
    consumed !== null && remaining !== null ? consumed + remaining : finiteNumber(root.total ?? root.limit);
  const windows: ProviderUsageWindow[] = [];
  const bal = balanceWindow("credits", "credits", consumed, limit, remaining, null);
  if (bal) windows.push(bal);
  return {
    id: "kimik2",
    displayName: providerDisplayName("kimik2"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no credit fields" } : {}),
  };
}

/** Poe current_balance payload. */
export function normalizePoeUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const root = asRecord(body);
  const balance = finiteNumber(
    root.current_point_balance ?? root.currentPointBalance ?? root.balance ?? root.points,
  );
  const windows: ProviderUsageWindow[] = [];
  const bal = balanceWindow("balance", "pts", null, null, balance, null, "pts");
  if (bal) windows.push(bal);
  return {
    id: "poe",
    displayName: providerDisplayName("poe"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no balance" } : {}),
  };
}

/** Crof usage_api payload. */
export function normalizeCrofUsagePayload(
  body: unknown,
  opts?: { fetchedAt?: number },
): ProviderUsageSnapshot {
  const root = asRecord(body);
  const windows: ProviderUsageWindow[] = [];
  const requestsPlan = finiteNumber(root.requests_plan ?? root.requestsPlan);
  const usable = finiteNumber(root.usable_requests ?? root.usableRequests);
  if (requestsPlan !== null && requestsPlan > 0 && usable !== null) {
    const used = Math.max(0, requestsPlan - usable);
    windows.push({
      id: "requests",
      label: "req",
      utilization: (used / requestsPlan) * 100,
      resetsAt: null,
    });
  }
  const credits = finiteNumber(root.credits);
  const creditWin = balanceWindow("credits", "credits", null, null, credits, null);
  if (creditWin) windows.push(creditWin);
  return {
    id: "crof",
    displayName: providerDisplayName("crof"),
    status: windows.length > 0 ? "ok" : "error",
    windows,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
    ...(windows.length === 0 ? { error: "no crof usage fields" } : {}),
  };
}
