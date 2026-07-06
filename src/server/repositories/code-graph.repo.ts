import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "~/db/client";
import {
  graphEdges,
  graphFiles,
  graphNodes,
  type GraphEdge,
  type GraphNode,
  type NewGraphEdge,
  type NewGraphFile,
  type NewGraphNode,
} from "~/db/schema";
import {
  emptyGraphIndexState,
  graphIndexStateKey,
  type GraphConfidence,
  type GraphEdgeKind,
  type GraphIndexState,
} from "~/shared/code-graph";
import { getAppSetting, setAppSetting, deleteAppSetting } from "./app-settings.repo";

// --- Index-state (persisted as a JSON row in app_settings) ---

export function readGraphIndexState(projectId: string): GraphIndexState {
  const raw = getAppSetting(graphIndexStateKey(projectId));
  if (!raw) return emptyGraphIndexState();
  try {
    const parsed = JSON.parse(raw) as Partial<GraphIndexState>;
    return { ...emptyGraphIndexState(), ...parsed, fileHashes: parsed.fileHashes ?? {} };
  } catch {
    return emptyGraphIndexState();
  }
}

export function writeGraphIndexState(projectId: string, state: GraphIndexState): void {
  setAppSetting(graphIndexStateKey(projectId), JSON.stringify(state));
}

export function deleteGraphIndexState(projectId: string): void {
  deleteAppSetting(graphIndexStateKey(projectId));
}

// --- Write side (indexer) ---

export function deleteGraphForProject(projectId: string): void {
  getDb().transaction((tx) => {
    tx.delete(graphEdges).where(eq(graphEdges.projectId, projectId)).run();
    tx.delete(graphNodes).where(eq(graphNodes.projectId, projectId)).run();
  });
}

/** Node ids belonging to a set of files (for incremental delete). */
export function nodeIdsForFiles(projectId: string, filePaths: readonly string[]): string[] {
  if (!filePaths.length) return [];
  const rows = getDb()
    .select({ id: graphNodes.id })
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), inArray(graphNodes.filePath, filePaths as string[])))
    .all();
  return rows.map((r) => r.id);
}

/**
 * Prepare a set of files for re-index: delete their nodes and OUTGOING edges
 * (the re-parse rebuilds those), but DETACH inbound edges from other files
 * instead of deleting them — the target node is about to be re-created under a
 * new id, so the edge survives as an unresolved by-name reference
 * (`dst_id NULL`, `dst_name` kept) and the post-insert re-resolution pass
 * re-attaches it. Deleting inbound edges here (the pre-versioning behavior)
 * permanently destroyed every unchanged file's edges into a changed file.
 */
export function pruneGraphForFiles(projectId: string, filePaths: readonly string[]): void {
  if (!filePaths.length) return;
  const ids = nodeIdsForFiles(projectId, filePaths);
  getDb().transaction((tx) => {
    if (ids.length) {
      // Chunk the IN() lists so we never exceed SQLite's variable limit.
      for (const chunk of chunked(ids, 400)) {
        tx.delete(graphEdges)
          .where(and(eq(graphEdges.projectId, projectId), inArray(graphEdges.srcId, chunk)))
          .run();
      }
      for (const chunk of chunked(ids, 400)) {
        // Only imports/calls can dangle by name; `defines` edges always
        // originate in the same file and were deleted above (kind guard is
        // defensive).
        tx.update(graphEdges)
          .set({ dstId: null, confidence: "ambiguous" })
          .where(
            and(
              eq(graphEdges.projectId, projectId),
              inArray(graphEdges.dstId, chunk),
              inArray(graphEdges.kind, ["imports", "calls"]),
            ),
          )
          .run();
      }
    }
    tx.delete(graphNodes)
      .where(and(eq(graphNodes.projectId, projectId), inArray(graphNodes.filePath, filePaths as string[])))
      .run();
  });
}

/** A detached/never-resolved edge, joined with its source node's file. */
export interface DanglingEdgeRow {
  id: string;
  kind: GraphEdgeKind;
  dstName: string;
  isMember: boolean;
  /** Null when the src node vanished (shouldn't happen; tolerated). */
  srcFilePath: string | null;
}

function danglingEdgeSelect() {
  return getDb()
    .select({
      id: graphEdges.id,
      kind: graphEdges.kind,
      dstName: graphEdges.dstName,
      isMember: graphEdges.isMember,
      srcFilePath: graphNodes.filePath,
    })
    .from(graphEdges)
    .leftJoin(graphNodes, eq(graphEdges.srcId, graphNodes.id));
}

/** Dangling call edges whose target name is one of `dstNames` (chunked IN). */
export function listDanglingCallEdges(
  projectId: string,
  dstNames: readonly string[],
): DanglingEdgeRow[] {
  const out: DanglingEdgeRow[] = [];
  for (const chunk of chunked([...dstNames], 400)) {
    if (!chunk.length) continue;
    const rows = danglingEdgeSelect()
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.kind, "calls"),
          isNull(graphEdges.dstId),
          inArray(graphEdges.dstName, chunk),
        ),
      )
      .all();
    for (const r of rows) {
      if (r.dstName !== null) out.push(r as DanglingEdgeRow);
    }
  }
  return out;
}

/**
 * Dangling import edges whose specifier starts with one of `specPrefixes`
 * (`.` for relative imports plus the project's tsconfig alias prefixes) —
 * bare package imports can never resolve internally, so they're excluded in
 * SQL rather than fetched and dropped.
 */
export function listDanglingImportEdges(
  projectId: string,
  specPrefixes: readonly string[],
): DanglingEdgeRow[] {
  if (!specPrefixes.length) return [];
  const likes = specPrefixes.map((p) => likeEscaped(graphEdges.dstName, `${escapeLike(p)}%`));
  const rows = danglingEdgeSelect()
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        eq(graphEdges.kind, "imports"),
        isNull(graphEdges.dstId),
        isNotNull(graphEdges.dstName),
        or(...likes),
      ),
    )
    .all();
  return rows.filter((r): r is DanglingEdgeRow => r.dstName !== null);
}

/** Re-attach dangling edges that resolved against the fresh node index. */
export function resolveDanglingEdges(
  updates: ReadonlyArray<{ id: string; dstId: string; confidence: GraphConfidence }>,
): void {
  if (!updates.length) return;
  getDb().transaction((tx) => {
    for (const u of updates) {
      tx.update(graphEdges)
        .set({ dstId: u.dstId, confidence: u.confidence })
        .where(eq(graphEdges.id, u.id))
        .run();
    }
  });
}

export function insertGraphNodes(rows: NewGraphNode[]): void {
  if (!rows.length) return;
  const db = getDb();
  db.transaction((tx) => {
    for (const chunk of chunked(rows, 500)) {
      tx.insert(graphNodes).values(chunk).run();
    }
  });
}

export function insertGraphEdges(rows: NewGraphEdge[]): void {
  if (!rows.length) return;
  const db = getDb();
  db.transaction((tx) => {
    for (const chunk of chunked(rows, 500)) {
      tx.insert(graphEdges).values(chunk).run();
    }
  });
}

/** Lightweight node index for edge resolution (no line spans/signatures). */
export function listNodeIndex(
  projectId: string,
): Array<Pick<GraphNode, "id" | "kind" | "name" | "filePath" | "exported">> {
  return getDb()
    .select({
      id: graphNodes.id,
      kind: graphNodes.kind,
      name: graphNodes.name,
      filePath: graphNodes.filePath,
      exported: graphNodes.exported,
    })
    .from(graphNodes)
    .where(eq(graphNodes.projectId, projectId))
    .all();
}

/**
 * Recompute the cached `degree` (incident edge count) for every node in a
 * project, in one pass. Resolved edges count for both endpoints; unresolved
 * (dstId null) edges count only for their src. Two grouped scans of the edge
 * table + one join-update — the previous per-node correlated subquery with an
 * OR ran the whole edge table once per node and defeated both edge indexes.
 * Zeroing first is required: UPDATE...FROM only touches join-matched rows, so
 * a node that lost its last edge would otherwise keep a stale degree.
 */
export function recomputeDegrees(projectId: string): void {
  const now = Date.now();
  getDb().transaction((tx) => {
    tx.run(sql`
      UPDATE graph_nodes SET degree = 0, updated_at = ${now}
      WHERE project_id = ${projectId}
    `);
    tx.run(sql`
      WITH deg AS (
        SELECT nid, SUM(c) AS d FROM (
          SELECT src_id AS nid, COUNT(*) AS c FROM graph_edges
           WHERE project_id = ${projectId} GROUP BY src_id
          UNION ALL
          SELECT dst_id AS nid, COUNT(*) AS c FROM graph_edges
           WHERE project_id = ${projectId} AND dst_id IS NOT NULL GROUP BY dst_id
        ) GROUP BY nid
      )
      UPDATE graph_nodes SET degree = deg.d, updated_at = ${now}
      FROM deg
      WHERE graph_nodes.id = deg.nid AND graph_nodes.project_id = ${projectId}
    `);
  });
}

// --- Per-file stat/hash index (graph_files) — drives the incremental read
// fastpath: (size, mtime) match ⇒ trust the stored hash, skip the read. ---

export interface GraphFileStat {
  size: number;
  mtimeMs: number;
  hash: string;
}

export function readGraphFileStats(projectId: string): Map<string, GraphFileStat> {
  const out = new Map<string, GraphFileStat>();
  const rows = getDb().select().from(graphFiles).where(eq(graphFiles.projectId, projectId)).all();
  for (const r of rows) out.set(r.path, { size: r.size, mtimeMs: r.mtimeMs, hash: r.hash });
  return out;
}

/** Full replace (full builds): drop the project's rows and insert the new set. */
export function replaceGraphFileStats(projectId: string, rows: NewGraphFile[]): void {
  getDb().transaction((tx) => {
    tx.delete(graphFiles).where(eq(graphFiles.projectId, projectId)).run();
    for (const chunk of chunked(rows, 500)) {
      if (chunk.length) tx.insert(graphFiles).values(chunk).run();
    }
  });
}

/** Incremental: upsert changed rows and drop removed paths, one transaction. */
export function updateGraphFileStats(
  projectId: string,
  upserts: NewGraphFile[],
  removedPaths: readonly string[],
): void {
  if (!upserts.length && !removedPaths.length) return;
  getDb().transaction((tx) => {
    for (const chunk of chunked(upserts, 500)) {
      if (!chunk.length) continue;
      tx.insert(graphFiles)
        .values(chunk)
        .onConflictDoUpdate({
          target: [graphFiles.projectId, graphFiles.path],
          set: {
            size: sql`excluded.size`,
            mtimeMs: sql`excluded.mtime_ms`,
            hash: sql`excluded.hash`,
          },
        })
        .run();
    }
    for (const chunk of chunked([...removedPaths], 400)) {
      if (!chunk.length) continue;
      tx.delete(graphFiles)
        .where(and(eq(graphFiles.projectId, projectId), inArray(graphFiles.path, chunk)))
        .run();
    }
  });
}

// --- Read side (status / summary / queries) ---

export function countNodes(projectId: string): number {
  const row = getDb()
    .select({ c: sql<number>`COUNT(*)` })
    .from(graphNodes)
    .where(eq(graphNodes.projectId, projectId))
    .get();
  return row?.c ?? 0;
}

export function countEdges(projectId: string): number {
  const row = getDb()
    .select({ c: sql<number>`COUNT(*)` })
    .from(graphEdges)
    .where(eq(graphEdges.projectId, projectId))
    .get();
  return row?.c ?? 0;
}

export function countFileNodes(projectId: string): number {
  const row = getDb()
    .select({ c: sql<number>`COUNT(*)` })
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), eq(graphNodes.kind, "file")))
    .get();
  return row?.c ?? 0;
}

export function confidenceBreakdown(projectId: string): Record<GraphConfidence, number> {
  const rows = getDb()
    .select({ confidence: graphEdges.confidence, c: sql<number>`COUNT(*)` })
    .from(graphEdges)
    .where(eq(graphEdges.projectId, projectId))
    .groupBy(graphEdges.confidence)
    .all();
  const out: Record<GraphConfidence, number> = { extracted: 0, inferred: 0, ambiguous: 0 };
  for (const r of rows) {
    if (r.confidence in out) out[r.confidence as GraphConfidence] = r.c;
  }
  return out;
}

export function getNodeById(projectId: string, id: string): GraphNode | null {
  return (
    getDb()
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.projectId, projectId), eq(graphNodes.id, id)))
      .get() ?? null
  );
}

/** Top-N nodes by degree (god nodes); files can be excluded for symbol-only views. */
export function topNodesByDegree(
  projectId: string,
  limit: number,
  opts: { excludeFiles?: boolean } = {},
): GraphNode[] {
  const where = opts.excludeFiles
    ? and(eq(graphNodes.projectId, projectId), sql`${graphNodes.kind} != 'file'`)
    : eq(graphNodes.projectId, projectId);
  return getDb()
    .select()
    .from(graphNodes)
    .where(where)
    .orderBy(desc(graphNodes.degree))
    .limit(limit)
    .all();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function likeEscaped(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/** Substring search over node name/path (LIKE), most-connected first. */
export function searchNodes(projectId: string, query: string, limit: number): GraphNode[] {
  const pattern = `%${escapeLike(query)}%`;
  const match = or(likeEscaped(graphNodes.name, pattern), likeEscaped(graphNodes.filePath, pattern));
  return getDb()
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), match))
    .orderBy(desc(graphNodes.degree))
    .limit(limit)
    .all();
}

/** Nodes matching an exact name (for resolving a `graph_*` tool's node arg). */
export function findNodesByName(projectId: string, name: string, limit: number): GraphNode[] {
  return getDb()
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), eq(graphNodes.name, name)))
    .orderBy(desc(graphNodes.degree))
    .limit(limit)
    .all();
}

/** Outgoing edges from a node. */
export function edgesFrom(projectId: string, nodeId: string): GraphEdge[] {
  return getDb()
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.projectId, projectId), eq(graphEdges.srcId, nodeId)))
    .all();
}

/** Incoming edges to a node. */
export function edgesTo(projectId: string, nodeId: string): GraphEdge[] {
  return getDb()
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.projectId, projectId), eq(graphEdges.dstId, nodeId)))
    .all();
}

// Ranked variants for getNeighbors: most-connected neighbors first, so a
// truncated result keeps the load-bearing edges. Unresolved edges (no far
// node → NULL degree) sort last. Traversals (path/impact) keep the unranked
// full fetches above.

/** Outgoing edges, best-connected target first, capped. */
export function edgesFromRanked(projectId: string, nodeId: string, limit: number): GraphEdge[] {
  return getDb()
    .select({
      id: graphEdges.id,
      projectId: graphEdges.projectId,
      srcId: graphEdges.srcId,
      dstId: graphEdges.dstId,
      dstName: graphEdges.dstName,
      kind: graphEdges.kind,
      confidence: graphEdges.confidence,
      isMember: graphEdges.isMember,
      createdAt: graphEdges.createdAt,
    })
    .from(graphEdges)
    .leftJoin(graphNodes, eq(graphEdges.dstId, graphNodes.id))
    .where(and(eq(graphEdges.projectId, projectId), eq(graphEdges.srcId, nodeId)))
    .orderBy(sql`${graphNodes.degree} IS NULL`, desc(graphNodes.degree))
    .limit(limit)
    .all();
}

/** Incoming edges, best-connected source first, capped. */
export function edgesToRanked(projectId: string, nodeId: string, limit: number): GraphEdge[] {
  return getDb()
    .select({
      id: graphEdges.id,
      projectId: graphEdges.projectId,
      srcId: graphEdges.srcId,
      dstId: graphEdges.dstId,
      dstName: graphEdges.dstName,
      kind: graphEdges.kind,
      confidence: graphEdges.confidence,
      isMember: graphEdges.isMember,
      createdAt: graphEdges.createdAt,
    })
    .from(graphEdges)
    .leftJoin(graphNodes, eq(graphEdges.srcId, graphNodes.id))
    .where(and(eq(graphEdges.projectId, projectId), eq(graphEdges.dstId, nodeId)))
    .orderBy(sql`${graphNodes.degree} IS NULL`, desc(graphNodes.degree))
    .limit(limit)
    .all();
}

/** All file nodes of a project (small: one row per indexed file). */
export function listFileNodes(projectId: string): GraphNode[] {
  return getDb()
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), eq(graphNodes.kind, "file")))
    .all();
}

/** Batch node fetch by id (for hydrating neighbors/paths). */
export function getNodesByIds(projectId: string, ids: readonly string[]): Map<string, GraphNode> {
  const out = new Map<string, GraphNode>();
  for (const chunk of chunked([...ids], 400)) {
    if (!chunk.length) continue;
    const rows = getDb()
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.projectId, projectId), inArray(graphNodes.id, chunk)))
      .all();
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
