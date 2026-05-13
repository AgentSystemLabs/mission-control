import { inArray, sql } from "drizzle-orm";
import { getDb } from "~/db/client";
import { tasks } from "~/db/schema";
import type { TaskStatus } from "~/shared/domain";
import { type Counts, emptyCounts, isActiveStatus } from "./internal";

/**
 * Aggregated task counts per project, computed in SQL to avoid loading every
 * task row into JS for the list view. Only non-archived tasks contribute to
 * the active counts and total (matches legacy `decorate()` behavior).
 */
export function loadCountsByProject(): Map<string, Counts> {
  const db = getDb();
  const rows = db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      archived: tasks.archived,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .groupBy(tasks.projectId, tasks.status, tasks.archived)
    .all();

  const out = new Map<string, Counts>();
  for (const r of rows) {
    if (r.archived) continue;
    let c = out.get(r.projectId);
    if (!c) {
      c = emptyCounts();
      out.set(r.projectId, c);
    }
    const status = r.status as TaskStatus;
    const n = Number(r.count) || 0;
    c[status] = (c[status] ?? 0) + n;
    c.total += n;
    if (isActiveStatus(status) && status !== "finished") c.activeNonDone += n;
  }
  return out;
}

/**
 * Pull a preview snippet for each project's most-relevant active task
 * (running, else needs-input). Fetches just the columns we need for the
 * projects we're showing — not every task row.
 */
export function loadPreviewByProject(projectIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (projectIds.length === 0) return out;
  const db = getDb();
  const rows = db
    .select({
      projectId: tasks.projectId,
      status: tasks.status,
      preview: tasks.preview,
    })
    .from(tasks)
    .where(
      sql`${tasks.archived} = 0 AND ${tasks.status} IN ('running','needs-input') AND ${inArray(tasks.projectId, projectIds)}`,
    )
    .all();
  // running wins over needs-input
  for (const r of rows) {
    const existing = out.get(r.projectId);
    if (r.status === "running") {
      out.set(r.projectId, r.preview ?? null);
    } else if (!existing) {
      out.set(r.projectId, r.preview ?? null);
    }
  }
  return out;
}
