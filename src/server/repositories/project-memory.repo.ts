import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb, getSqlite } from "~/db/client";
import { projectMemory, type NewProjectMemory, type ProjectMemory } from "~/db/schema";

export function insertMemoryRow(row: NewProjectMemory): void {
  getDb().insert(projectMemory).values(row).run();
}

export function getMemoryById(id: string): ProjectMemory | null {
  return getDb().select().from(projectMemory).where(eq(projectMemory.id, id)).get() ?? null;
}

/** All memories for a project, newest first. Archived rows excluded by default. */
export function listMemoryByProject(
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): ProjectMemory[] {
  const where = opts.includeArchived
    ? eq(projectMemory.projectId, projectId)
    : and(eq(projectMemory.projectId, projectId), eq(projectMemory.status, "active"));
  return getDb()
    .select()
    .from(projectMemory)
    .where(where)
    .orderBy(desc(projectMemory.pinned), desc(projectMemory.updatedAt))
    .all();
}

/**
 * Active, non-superseded memories used to assemble the Session Brief. Ordered
 * pinned-first then by type weight is applied in the service (ranking), so here
 * we just return the candidate set for the project/scope.
 */
export function listBriefCandidates(projectId: string, scopeId: string): ProjectMemory[] {
  return getDb()
    .select()
    .from(projectMemory)
    .where(
      and(
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.status, "active"),
        // Only the head of a supersede chain (superseded_by_id IS NULL).
        sql`${projectMemory.supersededById} IS NULL`,
        or(eq(projectMemory.scopeId, scopeId), eq(projectMemory.scopeId, "local")),
      ),
    )
    .orderBy(desc(projectMemory.pinned), asc(projectMemory.type))
    .all();
}

export function updateMemoryRow(
  id: string,
  patch: Partial<Omit<NewProjectMemory, "id" | "projectId" | "createdAt">>,
): ProjectMemory | null {
  getDb().update(projectMemory).set(patch).where(eq(projectMemory.id, id)).run();
  return getMemoryById(id);
}

/** Hard delete (used by the panel's "delete"); soft-delete goes through updateMemoryRow(status). */
export function deleteMemoryRow(id: string): void {
  getDb().delete(projectMemory).where(eq(projectMemory.id, id)).run();
}

/**
 * Point an old memory at the new head that replaces it and archive it, in one
 * write. The new head must already be inserted (active, `supersededById` NULL)
 * so brief candidacy — which selects `status = 'active' AND superseded_by_id IS
 * NULL` — flips cleanly from the old row to the new one.
 */
export function supersedeMemoryRow(oldId: string, newHeadId: string, now: number): void {
  getDb()
    .update(projectMemory)
    .set({ status: "archived", supersededById: newHeadId, updatedAt: now })
    .where(eq(projectMemory.id, oldId))
    .run();
}

/** Increment usage + stamp last-used for memories included in a brief. */
export function bumpMemoryUsage(ids: readonly string[], now: number): void {
  if (!ids.length) return;
  getDb().transaction((tx) => {
    for (const id of ids) {
      tx.update(projectMemory)
        .set({ usageCount: sql`${projectMemory.usageCount} + 1`, lastUsedAt: now })
        .where(eq(projectMemory.id, id))
        .run();
    }
  });
}

// Escape SQLite LIKE wildcards so a user typing `%`, `_`, or `\` searches
// literally. Paired with an explicit `ESCAPE '\'` clause below.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function likeEscaped(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

export type MemoryMatchMode = "any" | "all";

interface SearchMemoryArgs {
  projectId: string;
  query: string;
  limit: number;
  /** Restrict hits to these scopes IN SQL (before LIMIT), when provided. */
  scopeIds?: readonly string[];
  /** `any` (OR, default — broad recall) or `all` (AND — precise). */
  matchMode?: MemoryMatchMode;
}

/** A search hit with its raw text-relevance rank (bm25: lower = better; null on the LIKE path). */
export interface RankedMemoryRow {
  row: ProjectMemory;
  rank: number | null;
}

/**
 * Relevance search over title/body/tags within a single project's active
 * memories. Uses the FTS5 index (bm25-ranked) when available and degrades
 * transparently to LIKE substring search otherwise. Same return shape either
 * way. Final ordering is the service's job (it blends text relevance with
 * pinned/recency/usage metadata); rows come back best-text-match first.
 */
export function searchMemory(args: SearchMemoryArgs): ProjectMemory[] {
  return searchMemoryRanked(args).map((r) => r.row);
}

/** As searchMemory, but keeps the raw text rank so callers can blend scores. */
export function searchMemoryRanked(args: SearchMemoryArgs): RankedMemoryRow[] {
  const query = args.query.trim();
  if (!query) return [];

  if (memoryFtsAvailable()) {
    const match = buildFtsMatch(query, args.matchMode);
    if (match) {
      try {
        return searchMemoryFts({ ...args, match });
      } catch {
        // Malformed MATCH or a runtime FTS error — fall through to LIKE.
      }
    }
  }
  return searchMemoryLike({ ...args, query });
}

/** FTS5 path: rank rowids by bm25, then hydrate in that order. */
function searchMemoryFts({
  projectId,
  match,
  limit,
  scopeIds,
}: {
  projectId: string;
  match: string;
  limit: number;
  scopeIds?: readonly string[];
}): RankedMemoryRow[] {
  // Use the FTS table's real name in MATCH and bm25() — the bm25 auxiliary
  // function rejects a table alias ("no such column").
  const scopeClause = scopeIds?.length
    ? ` AND pm.scope_id IN (${scopeIds.map(() => "?").join(", ")})`
    : "";
  const rows = getSqlite()
    .prepare(
      `SELECT pm.id AS id, bm25(project_memory_fts) AS rank
         FROM project_memory_fts
         JOIN project_memory pm ON pm.rowid = project_memory_fts.rowid
        WHERE project_memory_fts MATCH ?
          AND pm.project_id = ?
          AND pm.status = 'active'${scopeClause}
        ORDER BY bm25(project_memory_fts)
        LIMIT ?`,
    )
    .all(match, projectId, ...(scopeIds?.length ? scopeIds : []), limit) as {
    id: string;
    rank: number;
  }[];
  if (!rows.length) return [];
  const byId = new Map(
    getDb()
      .select()
      .from(projectMemory)
      .where(inArray(projectMemory.id, rows.map((r) => r.id)))
      .all()
      .map((m) => [m.id, m]),
  );
  // Preserve the bm25 ranking order (the IN() fetch above is unordered).
  const out: RankedMemoryRow[] = [];
  for (const r of rows) {
    const row = byId.get(r.id);
    if (row) out.push({ row, rank: r.rank });
  }
  return out;
}

/** LIKE fallback: substring match over title/body/tags, pinned-then-recent order. */
function searchMemoryLike({
  projectId,
  query,
  limit,
  scopeIds,
  matchMode,
}: SearchMemoryArgs): RankedMemoryRow[] {
  // `any`: the whole query as one substring (historic behavior). `all`: every
  // token must appear somewhere in title/body/tags.
  const terms =
    matchMode === "all" ? (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [query]) : [query];
  const termClauses = terms.map((t) => {
    const pattern = `%${escapeLike(t)}%`;
    return or(
      likeEscaped(projectMemory.title, pattern),
      likeEscaped(projectMemory.body, pattern),
      likeEscaped(projectMemory.tags, pattern),
    );
  });
  const filters = [
    eq(projectMemory.projectId, projectId),
    eq(projectMemory.status, "active"),
    ...termClauses,
  ];
  if (scopeIds?.length) filters.push(inArray(projectMemory.scopeId, scopeIds as string[]));
  return getDb()
    .select()
    .from(projectMemory)
    .where(and(...filters))
    .orderBy(desc(projectMemory.pinned), desc(projectMemory.updatedAt))
    .limit(limit)
    .all()
    .map((row) => ({ row, rank: null }));
}

// Turn a free-text query into a safe FTS5 MATCH string: lowercase alnum/underscore
// tokens (stopwords + single chars dropped), each a quoted prefix term. `any`
// joins with OR so ANY term can match and bm25 ranks the best hits first —
// this matters most for proactive recall, which searches with a whole
// natural-language prompt (implicit-AND would demand every word appear and
// almost never match). `all` joins with AND for precise keyword search.
// Returns "" when no usable tokens remain, so the caller falls back to LIKE.
// Capped so a pathological query can't build a huge MATCH expression.
const FTS_MAX_TERMS = 12;

// Common words that would only add noise (and false matches) to an OR query.
const FTS_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "was", "were", "be", "do", "does", "did", "how", "what", "where", "why",
  "when", "which", "who", "that", "this", "it", "its", "with", "as", "at",
  "by", "from", "i", "you", "we", "my", "our", "me", "can", "should", "would",
]);

export function buildFtsMatch(query: string, mode: MemoryMatchMode = "any"): string {
  const raw = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
  if (!raw) return "";
  const tokens = raw.filter((t) => t.length > 1 && !FTS_STOPWORDS.has(t));
  if (!tokens.length) return "";
  return tokens
    .slice(0, FTS_MAX_TERMS)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(mode === "all" ? " AND " : " OR ");
}

// Cached probe: does this DB have the FTS5 index? getDb() first so the runtime
// bootstrap (which creates it) has run before we look.
let ftsAvailable: boolean | null = null;

function memoryFtsAvailable(): boolean {
  if (ftsAvailable !== null) return ftsAvailable;
  try {
    getDb();
    const row = getSqlite()
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'project_memory_fts'")
      .get();
    ftsAvailable = Boolean(row);
  } catch {
    ftsAvailable = false;
  }
  return ftsAvailable;
}

/** Test-only: force the FTS availability probe (null re-probes on next call). */
export function __setMemoryFtsAvailableForTest(value: boolean | null): void {
  ftsAvailable = value;
}

/**
 * Near-duplicate lookup for dedup-on-capture: an active memory of the same type
 * in the same project whose title matches (case-insensitive), excluding `exceptId`.
 */
export function findDuplicateByTitle(
  projectId: string,
  type: string,
  title: string,
  exceptId?: string,
): ProjectMemory | null {
  const base = and(
    eq(projectMemory.projectId, projectId),
    eq(projectMemory.status, "active"),
    eq(projectMemory.type, type as ProjectMemory["type"]),
    sql`lower(${projectMemory.title}) = lower(${title})`,
  );
  const where = exceptId ? and(base, ne(projectMemory.id, exceptId)) : base;
  return getDb().select().from(projectMemory).where(where).get() ?? null;
}
