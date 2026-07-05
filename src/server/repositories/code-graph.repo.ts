import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "~/db/client";
import {
  graphEdges,
  graphNodes,
  type GraphEdge,
  type GraphNode,
  type NewGraphEdge,
  type NewGraphNode,
} from "~/db/schema";
import {
  emptyGraphIndexState,
  graphIndexStateKey,
  type GraphConfidence,
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

/** Delete the given files' nodes and every edge incident to them. */
export function deleteGraphForFiles(projectId: string, filePaths: readonly string[]): void {
  if (!filePaths.length) return;
  const ids = nodeIdsForFiles(projectId, filePaths);
  getDb().transaction((tx) => {
    if (ids.length) {
      // Chunk the IN() lists so we never exceed SQLite's variable limit.
      for (const chunk of chunked(ids, 400)) {
        tx.delete(graphEdges)
          .where(and(eq(graphEdges.projectId, projectId), or(inArray(graphEdges.srcId, chunk), inArray(graphEdges.dstId, chunk))))
          .run();
      }
    }
    tx.delete(graphNodes)
      .where(and(eq(graphNodes.projectId, projectId), inArray(graphNodes.filePath, filePaths as string[])))
      .run();
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
 * (dstId null) edges count only for their src.
 */
export function recomputeDegrees(projectId: string): void {
  const db = getDb();
  db.run(sql`
    UPDATE graph_nodes
    SET degree = (
      SELECT COUNT(*) FROM graph_edges e
      WHERE e.project_id = ${projectId}
        AND (e.src_id = graph_nodes.id OR e.dst_id = graph_nodes.id)
    ),
    updated_at = ${Date.now()}
    WHERE graph_nodes.project_id = ${projectId}
  `);
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
