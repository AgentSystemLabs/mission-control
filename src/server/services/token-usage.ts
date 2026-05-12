import { eq, gte, sql } from "drizzle-orm";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getDb, getSqlite } from "~/db/client";
import {
  projects,
  tasks,
  tokenUsage,
  tokenUsageSessionOffsets,
} from "~/db/schema";
import type {
  DailyUsage,
  ProjectUsage,
  SessionUsage,
  TokenTotals,
  UsageSummary,
} from "~/shared/token-usage";
import { EMPTY_TOTALS } from "~/shared/token-usage";

/**
 * Parse one JSONL line. Returns null for lines that don't carry token usage
 * (user messages, tool results, summaries, malformed JSON). Exported for tests.
 */
export function parseUsageLine(line: string): {
  uuid: string;
  ts: number;
  model: string | null;
  usage: TokenTotals;
} | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  if (obj.type !== "assistant") return null;
  const u = obj.message?.usage;
  if (!u || typeof u !== "object") return null;
  const uuid = typeof obj.uuid === "string" ? obj.uuid : null;
  if (!uuid) return null;
  const tsRaw = obj.timestamp;
  let ts = Date.now();
  if (typeof tsRaw === "string") {
    const parsed = Date.parse(tsRaw);
    if (!Number.isNaN(parsed)) ts = parsed;
  } else if (typeof tsRaw === "number") {
    ts = tsRaw;
  }
  return {
    uuid,
    ts,
    model: typeof obj.message?.model === "string" ? obj.message.model : null,
    usage: {
      inputTokens: numberOr0(u.input_tokens),
      outputTokens: numberOr0(u.output_tokens),
      cacheCreationTokens: numberOr0(u.cache_creation_input_tokens),
      cacheReadTokens: numberOr0(u.cache_read_input_tokens),
    },
  };
}

function numberOr0(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Map every Claude session id we can find on disk to the JSONL file holding
 * its log. Claude Code names files `<sessionId>.jsonl` under a per-cwd folder;
 * we read the dir tree once instead of guessing the cwd encoding.
 */
async function buildSessionFileIndex(): Promise<Map<string, string>> {
  const root = claudeProjectsRoot();
  const out = new Map<string, string>();
  let dirs: string[];
  try {
    dirs = await fsp.readdir(root);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const full = path.join(root, d);
    let entries: string[];
    try {
      entries = await fsp.readdir(full);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".jsonl")) continue;
      const sessionId = e.slice(0, -".jsonl".length);
      out.set(sessionId, path.join(full, e));
    }
  }
  return out;
}

/**
 * Single-flight gate so two simultaneous /usage opens don't both walk JSONL.
 * Resolved with the number of new rows ingested by this run.
 */
let inflight: Promise<number> | null = null;

export function syncTokenUsage(): Promise<number> {
  if (inflight) return inflight;
  const p = doSync();
  inflight = p;
  p.finally(() => {
    if (inflight === p) inflight = null;
  });
  return p;
}

type PendingSessionWrite = {
  taskId: string;
  projectId: string;
  sessionId: string;
  text: string;
  newOffset: number;
};

async function doSync(): Promise<number> {
  const db = getDb();
  const sqlite = getSqlite();

  const sessionRows = db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      claudeSessionId: tasks.claudeSessionId,
    })
    .from(tasks)
    .where(sql`${tasks.claudeSessionId} IS NOT NULL`)
    .all();

  if (sessionRows.length === 0) return 0;

  const offsetRows = db.select().from(tokenUsageSessionOffsets).all();
  const offsets = new Map(
    offsetRows.map((r) => [r.claudeSessionId, r.byteOffset])
  );

  const fileIndex = await buildSessionFileIndex();

  // Read every session's pending tail off the event loop BEFORE entering the
  // sync sqlite transaction. better-sqlite3 transactions cannot await, so file
  // I/O happens here; only DB writes happen inside `tx()`.
  const pending: PendingSessionWrite[] = [];
  for (const row of sessionRows) {
    const sessionId = row.claudeSessionId!;
    const file = fileIndex.get(sessionId);
    if (!file) continue;
    let size: number;
    try {
      const stat = await fsp.stat(file);
      size = stat.size;
    } catch {
      continue;
    }
    const prev = offsets.get(sessionId) ?? 0;
    // File rotation / truncation safety: re-read from 0.
    const start = size < prev ? 0 : prev;
    if (size === start) continue;
    let buf: Buffer;
    try {
      const fh = await fsp.open(file, "r");
      try {
        const length = size - start;
        buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, start);
      } finally {
        await fh.close();
      }
    } catch {
      continue;
    }
    // Trailing partial line guard: only commit through the last newline.
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) {
      // No complete line — try again next sync once more lines arrive.
      continue;
    }
    pending.push({
      taskId: row.taskId,
      projectId: row.projectId,
      sessionId,
      text: buf.subarray(0, lastNl + 1).toString("utf8"),
      newOffset: start + lastNl + 1,
    });
  }

  if (pending.length === 0) return 0;

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
  const now = Date.now();

  const tx = sqlite.transaction(() => {
    for (const p of pending) {
      for (const line of p.text.split("\n")) {
        const parsed = parseUsageLine(line);
        if (!parsed) continue;
        const result = insertUsage.run(
          `tu-${parsed.uuid}`,
          p.taskId,
          p.projectId,
          p.sessionId,
          parsed.uuid,
          parsed.model,
          parsed.usage.inputTokens,
          parsed.usage.outputTokens,
          parsed.usage.cacheCreationTokens,
          parsed.usage.cacheReadTokens,
          parsed.ts
        );
        if (result.changes > 0) inserted += 1;
      }
      upsertOffset.run(p.sessionId, p.taskId, p.projectId, p.newOffset, now);
    }
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

function getLastSyncedAt(): number | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = 'token_usage_last_sync_at'")
    .get() as { value?: string } | undefined;
  if (!row?.value) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

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

export function getUsageSummary(daysBack: number = 30): UsageSummary {
  const db = getDb();

  const totalsRow = db
    .select(sumCols)
    .from(tokenUsage)
    .get();
  const totals: TokenTotals = totalsRow
    ? {
        inputTokens: Number(totalsRow.inputTokens) || 0,
        outputTokens: Number(totalsRow.outputTokens) || 0,
        cacheCreationTokens: Number(totalsRow.cacheCreationTokens) || 0,
        cacheReadTokens: Number(totalsRow.cacheReadTokens) || 0,
      }
    : { ...EMPTY_TOTALS };

  const perProjectRows = db
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
  const perProject: ProjectUsage[] = perProjectRows
    .map((r) => ({
      projectId: r.projectId,
      name: r.name,
      icon: r.icon,
      iconColor: r.iconColor,
      inputTokens: Number(r.inputTokens) || 0,
      outputTokens: Number(r.outputTokens) || 0,
      cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
      cacheReadTokens: Number(r.cacheReadTokens) || 0,
    }))
    .sort((a, b) => totalOf(b) - totalOf(a));

  const sinceMs = startOfLocalDay(Date.now() - (daysBack - 1) * 86_400_000);
  const dayExpr = sql<string>`strftime('%Y-%m-%d', ${tokenUsage.ts} / 1000, 'unixepoch', 'localtime')`;
  const perDayRows = db
    .select({
      day: dayExpr,
      ...sumCols,
    })
    .from(tokenUsage)
    .where(gte(tokenUsage.ts, sinceMs))
    .groupBy(dayExpr)
    .all();
  const dayMap = new Map<string, DailyUsage>();
  for (const r of perDayRows) {
    dayMap.set(r.day as string, {
      day: r.day as string,
      inputTokens: Number(r.inputTokens) || 0,
      outputTokens: Number(r.outputTokens) || 0,
      cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
      cacheReadTokens: Number(r.cacheReadTokens) || 0,
    });
  }
  const perDay: DailyUsage[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = formatLocalDay(d);
    perDay.push(dayMap.get(key) ?? { day: key, ...EMPTY_TOTALS });
  }

  const perSessionRows = db
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
  const perSession: SessionUsage[] = perSessionRows
    .map((r) => ({
      taskId: r.taskId,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      lastTs: r.lastTs ? Number(r.lastTs) : null,
      inputTokens: Number(r.inputTokens) || 0,
      outputTokens: Number(r.outputTokens) || 0,
      cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
      cacheReadTokens: Number(r.cacheReadTokens) || 0,
    }))
    .sort((a, b) => totalOf(b) - totalOf(a));

  return {
    totals,
    perProject,
    perDay,
    perSession,
    lastSyncedAt: getLastSyncedAt(),
    ingested: 0,
  };
}

function totalOf(t: TokenTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Test seam: clear the in-flight singleton between tests. */
export function _resetSyncSingleton() {
  inflight = null;
}
