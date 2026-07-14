import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Correctness bar for the token-usage rollup: every summary read (which now sums
// token_usage_rollup) must equal the same aggregate computed straight from the
// raw token_usage table, across backfill, incremental ingest, dedupe, and the
// ON DELETE CASCADE path. A separate file so the DB singleton is bound to this
// suite's temp dir.

let sqlite: import("better-sqlite3").Database;
let repo: typeof import("../repositories/token-usage.repo");
let client: typeof import("~/db/client");
let tempUserDataDir: string;
let savedUserData: string | undefined;

const MS_PER_DAY = 86_400_000;
const DAY0 = Date.parse("2026-05-10T12:00:00.000Z");

type Totals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

// --- Raw-truth aggregates computed directly over token_usage. ---
function rawTotals(): Totals {
  const r = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens),0) AS inputTokens,
         COALESCE(SUM(output_tokens),0) AS outputTokens,
         COALESCE(SUM(cache_creation_tokens),0) AS cacheCreationTokens,
         COALESCE(SUM(cache_read_tokens),0) AS cacheReadTokens
       FROM token_usage`,
    )
    .get() as Totals;
  return r;
}

function rawPerProject() {
  return sqlite
    .prepare(
      `SELECT project_id AS projectId,
         SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
         SUM(cache_creation_tokens) AS cacheCreationTokens, SUM(cache_read_tokens) AS cacheReadTokens
       FROM token_usage GROUP BY project_id ORDER BY project_id`,
    )
    .all() as (Totals & { projectId: string })[];
}

function rawPerSession() {
  return sqlite
    .prepare(
      `SELECT task_id AS taskId, MAX(ts) AS lastTs,
         SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
         SUM(cache_creation_tokens) AS cacheCreationTokens, SUM(cache_read_tokens) AS cacheReadTokens
       FROM token_usage GROUP BY task_id ORDER BY task_id`,
    )
    .all() as (Totals & { taskId: string; lastTs: number })[];
}

function rawPerDaySince(sinceMs: number) {
  return sqlite
    .prepare(
      `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
         SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
         SUM(cache_creation_tokens) AS cacheCreationTokens, SUM(cache_read_tokens) AS cacheReadTokens
       FROM token_usage
       WHERE ts >= ?
       GROUP BY day ORDER BY day`,
    )
    .all(sinceMs) as (Totals & { day: string })[];
}

function insertRawRow(row: {
  uuid: string;
  taskId: string;
  projectId: string;
  sessionId: string;
  ts: number;
  i: number;
  o: number;
  cc: number;
  cr: number;
}) {
  sqlite
    .prepare(
      `INSERT INTO token_usage
         (id, task_id, project_id, claude_session_id, message_uuid, model,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ts)
       VALUES (?, ?, ?, ?, ?, 'm', ?, ?, ?, ?, ?)`,
    )
    .run(
      `tu-${row.uuid}`,
      row.taskId,
      row.projectId,
      row.sessionId,
      row.uuid,
      row.i,
      row.o,
      row.cc,
      row.cr,
      row.ts,
    );
}

function assertRollupMatchesRaw() {
  // Totals.
  expect(repo.selectTotals()).toEqual(rawTotals());

  // Per project (compare token sums keyed by projectId).
  const gotProj = new Map(
    repo.selectTotalsPerProject().map((p) => [p.projectId, {
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      cacheCreationTokens: p.cacheCreationTokens,
      cacheReadTokens: p.cacheReadTokens,
    }]),
  );
  for (const raw of rawPerProject()) {
    expect(gotProj.get(raw.projectId)).toEqual({
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      cacheCreationTokens: raw.cacheCreationTokens,
      cacheReadTokens: raw.cacheReadTokens,
    });
  }
  expect(gotProj.size).toBe(rawPerProject().length);

  // Per session (seeded well under the 200 cap, so all sessions appear).
  const gotSess = new Map(
    repo.selectTotalsPerSession().map((s) => [s.taskId, s]),
  );
  const rawSess = rawPerSession();
  expect(gotSess.size).toBe(rawSess.length);
  for (const raw of rawSess) {
    const got = gotSess.get(raw.taskId)!;
    expect(got.inputTokens).toBe(raw.inputTokens);
    expect(got.outputTokens).toBe(raw.outputTokens);
    expect(got.cacheCreationTokens).toBe(raw.cacheCreationTokens);
    expect(got.cacheReadTokens).toBe(raw.cacheReadTokens);
    expect(got.lastTs).toBe(raw.lastTs);
  }

  // Per day, windowed from a day before the earliest seed.
  const since = DAY0 - MS_PER_DAY;
  const gotDay = new Map(
    repo.selectTotalsPerDaySince(since).map((d) => [d.day, d]),
  );
  const rawDay = rawPerDaySince(since);
  expect(gotDay.size).toBe(rawDay.length);
  for (const raw of rawDay) {
    const got = gotDay.get(raw.day)!;
    expect(got.inputTokens).toBe(raw.inputTokens);
    expect(got.outputTokens).toBe(raw.outputTokens);
    expect(got.cacheCreationTokens).toBe(raw.cacheCreationTokens);
    expect(got.cacheReadTokens).toBe(raw.cacheReadTokens);
  }
}

describe("token usage rollup", () => {
  beforeAll(async () => {
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-rollup-"));
    savedUserData = process.env.MC_USER_DATA_DIR;
    process.env.MC_USER_DATA_DIR = tempUserDataDir;
    client = await import("~/db/client");
    repo = await import("../repositories/token-usage.repo");
    client.getDb();
    sqlite = client.getSqlite();

    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, icon, icon_color, pinned, branch, remember_agent_settings, saved_skip_permissions, saved_bare_session, created_at, updated_at)
         VALUES ('p1','P1','/tmp/p1','f','#111',0,'main',0,0,0,?,?), ('p2','P2','/tmp/p2','f','#222',0,'main',0,0,0,?,?)`,
      )
      .run(now, now, now, now);
    for (const [tid, pid] of [["t1", "p1"], ["t2", "p1"], ["t3", "p2"]] as const) {
      sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, title, agent, status, branch, preview, lines, archived, claude_session_id, claude_skip_permissions, claude_bare_session, created_at, updated_at)
           VALUES (?, ?, ?, 'claude-code','ready','main','',0,0,?,0,0,?,?)`,
        )
        .run(tid, pid, `Task ${tid}`, `sess-${tid}`, now, now);
    }
  });

  afterAll(() => {
    if (savedUserData === undefined) delete process.env.MC_USER_DATA_DIR;
    else process.env.MC_USER_DATA_DIR = savedUserData;
    try {
      fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    } catch {
      /* windows may hold the db file briefly */
    }
  });

  it("backfill reproduces the raw aggregate across days, projects, and sessions", () => {
    // Seed raw rows directly (pre-rollup state) spanning three local days.
    insertRawRow({ uuid: "a1", taskId: "t1", projectId: "p1", sessionId: "sess-t1", ts: DAY0, i: 100, o: 200, cc: 10, cr: 20 });
    insertRawRow({ uuid: "a2", taskId: "t1", projectId: "p1", sessionId: "sess-t1", ts: DAY0 + MS_PER_DAY, i: 5, o: 6, cc: 7, cr: 8 });
    insertRawRow({ uuid: "a3", taskId: "t2", projectId: "p1", sessionId: "sess-t2", ts: DAY0, i: 1, o: 2, cc: 3, cr: 4 });
    insertRawRow({ uuid: "a4", taskId: "t3", projectId: "p2", sessionId: "sess-t3", ts: DAY0 + 2 * MS_PER_DAY, i: 9, o: 8, cc: 7, cr: 6 });

    // Rollup is empty; backfill from raw.
    client.backfillTokenUsageRollup(sqlite);
    assertRollupMatchesRaw();

    // Idempotent: a second backfill call is a no-op (rollup already populated).
    client.backfillTokenUsageRollup(sqlite);
    assertRollupMatchesRaw();
  });

  it("incremental ingest keeps the rollup equal to raw, and dedupes", () => {
    // New rows via the ingest transaction: same-day/same-session accumulation,
    // plus a brand-new day for an existing session.
    const inserted = repo.ingestTokenUsageTx((commit) => {
      commit({
        rows: [
          { id: "tu-b1", taskId: "t1", projectId: "p1", claudeSessionId: "sess-t1", messageUuid: "b1", model: "m", inputTokens: 50, outputTokens: 60, cacheCreationTokens: 70, cacheReadTokens: 80, ts: DAY0 },
          { id: "tu-b2", taskId: "t3", projectId: "p2", claudeSessionId: "sess-t3", messageUuid: "b2", model: "m", inputTokens: 11, outputTokens: 12, cacheCreationTokens: 13, cacheReadTokens: 14, ts: DAY0 + 5 * MS_PER_DAY },
        ],
        sessionOffset: { claudeSessionId: "sess-t1", taskId: "t1", projectId: "p1", byteOffset: 10 },
      });
    }, Date.now());
    expect(inserted).toBe(2);
    assertRollupMatchesRaw();

    // Re-ingesting the same message_uuids must not double count.
    const insertedAgain = repo.ingestTokenUsageTx((commit) => {
      commit({
        rows: [
          { id: "tu-b1", taskId: "t1", projectId: "p1", claudeSessionId: "sess-t1", messageUuid: "b1", model: "m", inputTokens: 50, outputTokens: 60, cacheCreationTokens: 70, cacheReadTokens: 80, ts: DAY0 },
        ],
        sessionOffset: { claudeSessionId: "sess-t1", taskId: "t1", projectId: "p1", byteOffset: 20 },
      });
    }, Date.now());
    expect(insertedAgain).toBe(0);
    assertRollupMatchesRaw();
  });

  it("keeps the rollup equal to raw after a cascade delete", () => {
    // Deleting a task cascades its token_usage rows AND its rollup rows.
    sqlite.prepare("DELETE FROM tasks WHERE id = 't1'").run();
    const rollupForT1 = sqlite
      .prepare("SELECT COUNT(*) AS n FROM token_usage_rollup WHERE task_id = 't1'")
      .get() as { n: number };
    expect(rollupForT1.n).toBe(0);
    assertRollupMatchesRaw();
  });

  it("folds out-of-order ingests into the same day bucket with last_ts = max(ts)", () => {
    // Two ingests into the SAME (project, task, local-day) bucket, the newer ts
    // committed first and the older ts second, must accumulate tokens and keep
    // last_ts at the maximum — exercising the `last_ts = MAX(...)` upsert branch.
    const day = DAY0 + 10 * MS_PER_DAY;
    const laterTs = day + 5 * 3_600_000;
    const earlierTs = day + 1 * 3_600_000;
    repo.ingestTokenUsageTx((commit) => {
      commit({
        rows: [
          { id: "tu-o1", taskId: "t2", projectId: "p1", claudeSessionId: "sess-t2", messageUuid: "o1", model: "m", inputTokens: 3, outputTokens: 4, cacheCreationTokens: 5, cacheReadTokens: 6, ts: laterTs },
        ],
        sessionOffset: { claudeSessionId: "sess-t2", taskId: "t2", projectId: "p1", byteOffset: 30 },
      });
    }, Date.now());
    repo.ingestTokenUsageTx((commit) => {
      commit({
        rows: [
          { id: "tu-o2", taskId: "t2", projectId: "p1", claudeSessionId: "sess-t2", messageUuid: "o2", model: "m", inputTokens: 1, outputTokens: 1, cacheCreationTokens: 1, cacheReadTokens: 1, ts: earlierTs },
        ],
        sessionOffset: { claudeSessionId: "sess-t2", taskId: "t2", projectId: "p1", byteOffset: 40 },
      });
    }, Date.now());

    const bucket = sqlite
      .prepare(
        "SELECT input_tokens AS i, last_ts AS lastTs FROM token_usage_rollup WHERE project_id = 'p1' AND task_id = 't2' AND day = strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime')",
      )
      .get(laterTs) as { i: number; lastTs: number };
    expect(bucket.i).toBe(4); // 3 + 1 accumulated regardless of ingest order
    expect(bucket.lastTs).toBe(laterTs); // max, not the last-committed (earlier) ts
    assertRollupMatchesRaw();
  });

  it("keeps the rollup equal to raw after a whole-project cascade delete", () => {
    // Deleting a project cascades to its tasks, their token_usage rows, and their
    // rollup rows (the rollup's project_id/task_id FKs are both ON DELETE CASCADE).
    sqlite.prepare("DELETE FROM projects WHERE id = 'p2'").run();
    const rollupForP2 = sqlite
      .prepare("SELECT COUNT(*) AS n FROM token_usage_rollup WHERE project_id = 'p2'")
      .get() as { n: number };
    expect(rollupForP2.n).toBe(0);
    assertRollupMatchesRaw();
  });
});
