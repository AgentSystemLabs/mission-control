import { getDb, getSqlite } from "~/db/client";
import { tokenUsageSessionOffsets } from "~/db/schema";
import { PER_SESSION_LIMIT } from "~/shared/token-usage";

export type TotalsRow = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

// Every summary read below aggregates token_usage_rollup (pre-summed per
// project/task/local-day) rather than scanning token_usage, which keeps these
// sub-millisecond even at ~1M raw rows. The rollup is kept equal to the raw
// table by the ingest transaction and ON DELETE CASCADE (see ensureSchema).

export function selectTotals(): TotalsRow | null {
  const row = getSqlite()
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens
       FROM token_usage_rollup`,
    )
    .get() as TotalsRow | undefined;
  if (!row) return null;
  return {
    inputTokens: Number(row.inputTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    cacheCreationTokens: Number(row.cacheCreationTokens) || 0,
    cacheReadTokens: Number(row.cacheReadTokens) || 0,
  };
}

export type PerProjectRow = TotalsRow & {
  projectId: string;
  name: string;
  icon: string;
  iconColor: string;
};

export function selectTotalsPerProject(): PerProjectRow[] {
  const rows = getSqlite()
    .prepare(
      `SELECT
         r.project_id AS projectId,
         p.name AS name,
         p.icon AS icon,
         p.icon_color AS iconColor,
         COALESCE(SUM(r.input_tokens), 0) AS inputTokens,
         COALESCE(SUM(r.output_tokens), 0) AS outputTokens,
         COALESCE(SUM(r.cache_creation_tokens), 0) AS cacheCreationTokens,
         COALESCE(SUM(r.cache_read_tokens), 0) AS cacheReadTokens
       FROM token_usage_rollup r
       INNER JOIN projects p ON p.id = r.project_id
       GROUP BY r.project_id`,
    )
    .all() as PerProjectRow[];
  return rows.map((r) => ({
    projectId: r.projectId,
    name: r.name,
    icon: r.icon,
    iconColor: r.iconColor,
    inputTokens: Number(r.inputTokens) || 0,
    outputTokens: Number(r.outputTokens) || 0,
    cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
    cacheReadTokens: Number(r.cacheReadTokens) || 0,
  }));
}

export type PerDayRow = TotalsRow & { day: string };

export function selectTotalsPerDaySince(sinceMs: number): PerDayRow[] {
  const rows = getSqlite()
    .prepare(
      `SELECT
         day AS day,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens
       FROM token_usage_rollup
       WHERE day >= strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime')
       GROUP BY day`,
    )
    .all(sinceMs) as PerDayRow[];
  return rows.map((r) => ({
    day: String(r.day),
    inputTokens: Number(r.inputTokens) || 0,
    outputTokens: Number(r.outputTokens) || 0,
    cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
    cacheReadTokens: Number(r.cacheReadTokens) || 0,
  }));
}

export type PerSessionRow = TotalsRow & {
  taskId: string;
  title: string;
  projectId: string;
  projectName: string;
  lastTs: number | null;
};

export function selectTotalsPerSession(): PerSessionRow[] {
  // Bounded to the top PER_SESSION_LIMIT sessions by total tokens: the usage
  // panel renders one row per session, so an unbounded list would grow the DOM
  // (and this result set) without limit on long-lived installs.
  const rows = getSqlite()
    .prepare(
      `SELECT
         r.task_id AS taskId,
         t.title AS title,
         t.project_id AS projectId,
         p.name AS projectName,
         MAX(r.last_ts) AS lastTs,
         COALESCE(SUM(r.input_tokens), 0) AS inputTokens,
         COALESCE(SUM(r.output_tokens), 0) AS outputTokens,
         COALESCE(SUM(r.cache_creation_tokens), 0) AS cacheCreationTokens,
         COALESCE(SUM(r.cache_read_tokens), 0) AS cacheReadTokens
       FROM token_usage_rollup r
       INNER JOIN tasks t ON t.id = r.task_id
       INNER JOIN projects p ON p.id = t.project_id
       GROUP BY r.task_id
       ORDER BY (
         SUM(r.input_tokens) + SUM(r.output_tokens)
           + SUM(r.cache_creation_tokens) + SUM(r.cache_read_tokens)
       ) DESC
       LIMIT ?`,
    )
    .all(PER_SESSION_LIMIT) as (PerSessionRow & { lastTs: number | null })[];
  return rows.map((r) => ({
    taskId: r.taskId,
    title: r.title,
    projectId: r.projectId,
    projectName: r.projectName,
    lastTs: r.lastTs ? Number(r.lastTs) : null,
    inputTokens: Number(r.inputTokens) || 0,
    outputTokens: Number(r.outputTokens) || 0,
    cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
    cacheReadTokens: Number(r.cacheReadTokens) || 0,
  }));
}

export type SessionOffsetRow = {
  claudeSessionId: string;
  byteOffset: number;
};

export function findAllSessionOffsets(): SessionOffsetRow[] {
  return getDb()
    .select({
      claudeSessionId: tokenUsageSessionOffsets.claudeSessionId,
      byteOffset: tokenUsageSessionOffsets.byteOffset,
    })
    .from(tokenUsageSessionOffsets)
    .all();
}

export type TokenUsageIngestRow = {
  id: string;
  taskId: string;
  projectId: string;
  claudeSessionId: string;
  messageUuid: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  ts: number;
};

export type IngestResult = {
  inserted: number;
  lastSyncedAt: number | null;
};

/**
 * Ingest parsed JSONL chunks atomically using raw SQLite for prepared-statement
 * speed across thousands of rows. Returns the count of newly-inserted rows.
 *
 * The walker function is called inside the transaction with a `commitChunk` it
 * uses to drain parsed rows + the advanced byte offset for each session; this
 * lets the caller keep filesystem I/O outside this repo while still benefiting
 * from one round-trip transaction.
 */
export function ingestTokenUsageTx(
  walker: (commit: (params: {
    rows: TokenUsageIngestRow[];
    sessionOffset: {
      claudeSessionId: string;
      taskId: string;
      projectId: string;
      byteOffset: number;
    };
  }) => void) => void,
  now: number,
): number {
  const sqlite = getSqlite();
  const insertUsage = sqlite.prepare(
    `INSERT OR IGNORE INTO token_usage (
      id, task_id, project_id, claude_session_id, message_uuid, model,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upsertOffset = sqlite.prepare(
    `INSERT INTO token_usage_session_offsets
       (claude_session_id, task_id, project_id, byte_offset, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(claude_session_id) DO UPDATE SET
       task_id = excluded.task_id,
       project_id = excluded.project_id,
       byte_offset = excluded.byte_offset,
       updated_at = excluded.updated_at`
  );
  // Fold each newly-inserted row into its (project, task, local day) rollup
  // bucket. The day expression and the accumulation must match the backfill and
  // the read queries exactly so the rollup stays equal to the raw aggregate.
  const upsertRollup = sqlite.prepare(
    `INSERT INTO token_usage_rollup (
       project_id, task_id, day,
       input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, last_ts
     ) VALUES (
       ?, ?, strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime'), ?, ?, ?, ?, ?
     )
     ON CONFLICT(project_id, task_id, day) DO UPDATE SET
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
       cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
       last_ts = MAX(last_ts, excluded.last_ts)`
  );

  let inserted = 0;
  const tx = sqlite.transaction(() => {
    walker(({ rows, sessionOffset }) => {
      for (const r of rows) {
        const result = insertUsage.run(
          r.id,
          r.taskId,
          r.projectId,
          r.claudeSessionId,
          r.messageUuid,
          r.model,
          r.inputTokens,
          r.outputTokens,
          r.cacheCreationTokens,
          r.cacheReadTokens,
          r.ts,
        );
        // message_uuid is UNIQUE, so changes > 0 means this row is newly counted
        // (INSERT OR IGNORE skipped a duplicate otherwise). Only then fold it into
        // the rollup, or a re-seen line would be double-counted.
        if (result.changes > 0) {
          inserted += 1;
          upsertRollup.run(
            r.projectId,
            r.taskId,
            r.ts,
            r.inputTokens,
            r.outputTokens,
            r.cacheCreationTokens,
            r.cacheReadTokens,
            r.ts,
          );
        }
      }
      upsertOffset.run(
        sessionOffset.claudeSessionId,
        sessionOffset.taskId,
        sessionOffset.projectId,
        sessionOffset.byteOffset,
        now,
      );
    });
  });
  tx();

  if (inserted > 0) {
    sqlite
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES ('token_usage_last_sync_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(String(now));
  }
  return inserted;
}

export function getTokenUsageLastSyncedAt(): number | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = 'token_usage_last_sync_at'")
    .get() as { value?: string } | undefined;
  if (!row?.value) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}
