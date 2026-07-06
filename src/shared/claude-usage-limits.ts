/**
 * Claude Code usage limits — the live "session" (5-hour) and "weekly" rate-limit
 * windows shown in the top bar. These mirror what Claude Code's own `/usage`
 * screen and statusline display. Primary source: the shared cache file fed by
 * the statusline tap (src/shared/statusline-tap.ts), which Claude sessions
 * refresh for free. Fallback: Anthropic's heavily rate-limited OAuth usage
 * endpoint. See src/server/services/claude-usage-limits.ts.
 */

/** A single usage window (session or weekly). */
export type ClaudeUsageWindow = {
  /** Percent of the limit consumed, 0–100 (clamp in the UI; can round-trip >100). */
  utilization: number;
  /** ISO-8601 timestamp when this window resets, or null if the API omits it. */
  resetsAt: string | null;
};

export type ClaudeUsageLimitsStatus =
  | "ok"
  | "unauthenticated"
  | "rate_limited"
  | "error";

export type ClaudeUsageLimits = {
  /** Rolling 5-hour "session" window (API field `five_hour`). */
  session: ClaudeUsageWindow | null;
  /** 7-day "weekly (all models)" window (API field `seven_day`). */
  weekly: ClaudeUsageWindow | null;
  /** 7-day Opus-only window (API field `seven_day_opus`), when the plan reports it. */
  weeklyOpus: ClaudeUsageWindow | null;
  /** Outcome of the most recent fetch that produced this snapshot. */
  status: ClaudeUsageLimitsStatus;
  /** Epoch ms when this snapshot was produced (server clock). */
  fetchedAt: number;
  /** Human-readable detail when status !== "ok" (surfaced in the tooltip). */
  error?: string;
};

export const EMPTY_CLAUDE_USAGE_LIMITS: ClaudeUsageLimits = {
  session: null,
  weekly: null,
  weeklyOpus: null,
  status: "error",
  fetchedAt: 0,
};
