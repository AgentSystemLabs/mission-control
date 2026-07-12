export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type ProjectUsage = TokenTotals & {
  projectId: string;
  name: string;
  iconColor: string;
  icon: string;
};

export type SessionUsage = TokenTotals & {
  taskId: string;
  title: string;
  projectId: string;
  projectName: string;
  lastTs: number | null;
};

export type DailyUsage = TokenTotals & {
  /** YYYY-MM-DD in local time. */
  day: string;
};

export type UsageSummary = {
  totals: TokenTotals;
  perProject: ProjectUsage[];
  perDay: DailyUsage[];
  perSession: SessionUsage[];
  /** Last successful sync time (epoch ms), null if never synced. */
  lastSyncedAt: number | null;
  /**
   * True when a background JSONL sync is in flight, so this summary may be
   * stale/partial. The client polls back while true until it settles false.
   */
  syncing: boolean;
};

export const EMPTY_TOTALS: TokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

/**
 * Maximum number of per-session rows the usage summary returns/renders, ordered
 * by total tokens. Bounds both the query result and the DOM table on long-lived
 * installs with thousands of sessions.
 */
export const PER_SESSION_LIMIT = 200;
