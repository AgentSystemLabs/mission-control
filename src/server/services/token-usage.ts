import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  DailyUsage,
  ProjectUsage,
  SessionUsage,
  TokenTotals,
  UsageSummary,
} from "~/shared/token-usage";
import { EMPTY_TOTALS } from "~/shared/token-usage";
import {
  findAllSessionOffsets,
  getTokenUsageLastSyncedAt,
  ingestTokenUsageTx,
  selectTotals,
  selectTotalsPerDaySince,
  selectTotalsPerProject,
  selectTotalsPerSession,
  type TokenUsageIngestRow,
} from "../repositories/token-usage.repo";
import { findTasksWithClaudeSessionId } from "../repositories/tasks.repo";

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
function buildSessionFileIndex(): Map<string, string> {
  const root = claudeProjectsRoot();
  const out = new Map<string, string>();
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const full = path.join(root, d);
    let entries: string[];
    try {
      entries = fs.readdirSync(full);
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
  const p = Promise.resolve().then(doSync);
  inflight = p;
  p.finally(() => {
    if (inflight === p) inflight = null;
  });
  return p;
}

function doSync(): number {
  const sessionRows = findTasksWithClaudeSessionId();
  if (sessionRows.length === 0) return 0;

  const offsets = new Map(
    findAllSessionOffsets().map((r) => [r.claudeSessionId, r.byteOffset]),
  );
  const fileIndex = buildSessionFileIndex();
  const now = Date.now();

  return ingestTokenUsageTx((commit) => {
    for (const row of sessionRows) {
      const sessionId = row.claudeSessionId;
      const file = fileIndex.get(sessionId);
      if (!file) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const prev = offsets.get(sessionId) ?? 0;
      // File rotation / truncation safety: re-read from 0.
      const start = stat.size < prev ? 0 : prev;
      if (stat.size === start) continue;
      let buf: Buffer;
      try {
        const fd = fs.openSync(file, "r");
        try {
          const length = stat.size - start;
          buf = Buffer.alloc(length);
          fs.readSync(fd, buf, 0, length, start);
        } finally {
          fs.closeSync(fd);
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
      const consumable = buf.subarray(0, lastNl + 1).toString("utf8");
      const newOffset = start + lastNl + 1;
      const rows: TokenUsageIngestRow[] = [];
      for (const line of consumable.split("\n")) {
        const parsed = parseUsageLine(line);
        if (!parsed) continue;
        rows.push({
          id: `tu-${parsed.uuid}`,
          taskId: row.taskId,
          projectId: row.projectId,
          claudeSessionId: sessionId,
          messageUuid: parsed.uuid,
          model: parsed.model,
          inputTokens: parsed.usage.inputTokens,
          outputTokens: parsed.usage.outputTokens,
          cacheCreationTokens: parsed.usage.cacheCreationTokens,
          cacheReadTokens: parsed.usage.cacheReadTokens,
          ts: parsed.ts,
        });
      }
      commit({
        rows,
        sessionOffset: {
          claudeSessionId: sessionId,
          taskId: row.taskId,
          projectId: row.projectId,
          byteOffset: newOffset,
        },
      });
    }
  }, now);
}

export function getUsageSummary(daysBack: number = 30): UsageSummary {
  const totalsRow = selectTotals();
  const totals: TokenTotals = totalsRow ?? { ...EMPTY_TOTALS };

  const perProject: ProjectUsage[] = selectTotalsPerProject().sort(
    (a, b) => totalOf(b) - totalOf(a),
  );

  const sinceMs = startOfLocalDay(Date.now() - (daysBack - 1) * 86_400_000);
  const perDayRows = selectTotalsPerDaySince(sinceMs);
  const dayMap = new Map<string, DailyUsage>();
  for (const r of perDayRows) {
    dayMap.set(r.day, {
      day: r.day,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheCreationTokens: r.cacheCreationTokens,
      cacheReadTokens: r.cacheReadTokens,
    });
  }
  const perDay: DailyUsage[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = formatLocalDay(d);
    perDay.push(dayMap.get(key) ?? { day: key, ...EMPTY_TOTALS });
  }

  const perSession: SessionUsage[] = selectTotalsPerSession().sort(
    (a, b) => totalOf(b) - totalOf(a),
  );

  return {
    totals,
    perProject,
    perDay,
    perSession,
    lastSyncedAt: getTokenUsageLastSyncedAt(),
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
