import { eq, gte, sql } from "drizzle-orm";
import { getDb, getSqlite } from "~/db/client";
import {
  projects,
  tasks,
  tokenUsage,
  tokenUsageSessionOffsets,
} from "~/db/schema";

const sumCols = {
  inputTokens: sql<number>`COALESCE(SUM(${tokenUsage.inputTokens}), 0)`.as("input_tokens"),
  outputTokens: sql<number>`COALESCE(SUM(${tokenUsage.outputTokens}), 0)`.as("output_tokens"),
  cacheCreationTokens: sql<number>`COALESCE(SUM(${tokenUsage.cacheCreationTokens}), 0)`.as(
    "cache_creation_tokens"
  ),
  cacheReadTokens: sql<number>`COALESCE(SUM(${tokenUsage.cacheReadTokens}), 0)`.as(
    "cache_read_tokens"
  ),
};

export type TotalsRow = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export function selectTotals(): TotalsRow | null {
  const row = getDb().select(sumCols).from(tokenUsage).get();
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
  const rows = getDb()
    .select({
      projectId: projects.id,
      name: projects.name,
      icon: projects.icon,
      iconColor: projects.iconColor,
      ...sumCols,
    })
    .from(tokenUsage)
    .innerJoin(projects, eq(projects.id, tokenUsage.projectId))
    .groupBy(projects.id)
    .all();
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
  const dayExpr = sql<string>`strftime('%Y-%m-%d', ${tokenUsage.ts} / 1000, 'unixepoch', 'localtime')`;
  const rows = getDb()
    .select({
      day: dayExpr,
      ...sumCols,
    })
    .from(tokenUsage)
    .where(gte(tokenUsage.ts, sinceMs))
    .groupBy(dayExpr)
    .all();
  return rows.map((r) => ({
    day: r.day as string,
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
  const rows = getDb()
    .select({
      taskId: tokenUsage.taskId,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
      lastTs: sql<number>`MAX(${tokenUsage.ts})`.as("last_ts"),
      ...sumCols,
    })
    .from(tokenUsage)
    .innerJoin(tasks, eq(tasks.id, tokenUsage.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .groupBy(tokenUsage.taskId)
    .all();
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
        if (result.changes > 0) inserted += 1;
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
