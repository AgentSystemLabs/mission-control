import { z } from "zod";
import { getUsageSummary, syncTokenUsage } from "../services/token-usage";
import { json, parseSearchParams } from "./_helpers";

const DEFAULT_USAGE_DAYS = 30;
const MIN_USAGE_DAYS = 1;
const MAX_USAGE_DAYS = 365;
// How long to wait for the sync before answering from the DB anyway. The warm
// path (incremental tail read against the offsets table) finishes in single-
// digit ms, so it comfortably beats this budget and the response stays fully
// fresh. Only the first-ever cold sync of a large JSONL corpus (the measured
// ~4.8s cliff) exceeds it and falls through to the non-blocking path.
const SYNC_BUDGET_MS = 300;

const usageParams = z.object({
  days: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? String(DEFAULT_USAGE_DAYS), 10) || DEFAULT_USAGE_DAYS;
      return Math.max(MIN_USAGE_DAYS, Math.min(MAX_USAGE_DAYS, n));
    }),
  sync: z.string().optional(),
});

export async function read(url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, usageParams);
  if (!parsed.ok) return parsed.response;
  const skipSync = parsed.data.sync === "0";

  // Time-budgeted hybrid. syncTokenUsage() is single-flight, so this awaits the
  // shared in-flight sync (concurrent requests never stack new walks). If it
  // finishes within the budget — the normal warm/incremental case — the DB is
  // fully fresh and we answer exactly as before. Only when the budget is
  // exceeded (the first-ever cold walk of a big corpus) do we answer from the
  // current DB immediately and let the already-running sync finish in the
  // background; `syncing: true` tells the client (usageQueryOptions) to poll
  // until a later call comes back inside budget with the converged numbers.
  let syncing = false;
  if (!skipSync) {
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<"timeout">((resolve) => {
      budgetTimer = setTimeout(() => resolve("timeout"), SYNC_BUDGET_MS);
    });
    const sync = syncTokenUsage().then(
      () => "done" as const,
      (err) => {
        console.error("[usage] background token sync failed:", err);
        return "done" as const;
      },
    );
    syncing = (await Promise.race([sync, budget])) === "timeout";
    if (budgetTimer) clearTimeout(budgetTimer);
  }

  const summary = getUsageSummary(parsed.data.days);
  return json({ ...summary, syncing });
}
