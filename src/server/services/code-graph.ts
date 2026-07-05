// Read/query layer over the code graph: status + summary for the panel/brief,
// and the four navigation queries (search / neighbors / shortest-path / impact)
// that back the MCP tools. Pure reads — the indexer owns writes.

import {
  GRAPH_ENTRY_POINT_LIMIT,
  GRAPH_GOD_NODE_LIMIT,
  GRAPH_IMPACT_MAX_DEPTH,
  GRAPH_IMPACT_MAX_NODES,
  GRAPH_NEIGHBORS_MAX,
  GRAPH_PATH_MAX_DEPTH,
  type GraphNeighbor,
  type GraphNeighborDirection,
  type GraphNodeView,
  type GraphStatus,
  type GraphSummary,
  type GraphSummaryNode,
} from "~/shared/code-graph";
import type { GraphEdge, GraphNode } from "~/db/schema";
import {
  countEdges,
  countFileNodes,
  countNodes,
  edgesFrom,
  edgesTo,
  findNodesByName,
  getNodeById,
  getNodesByIds,
  readGraphIndexState,
  searchNodes,
  topNodesByDegree,
} from "../repositories/code-graph.repo";
import { getGraphIndexProgress } from "./code-graph-indexer";

export function toNodeView(row: GraphNode): GraphNodeView {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    exported: row.exported,
    signature: row.signature,
    language: row.language,
    degree: row.degree,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSummaryNode(row: GraphNode): GraphSummaryNode {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    filePath: row.filePath,
    startLine: row.startLine,
    degree: row.degree,
  };
}

/** Whole-graph status for the panel — live `indexing` block only while a build runs. */
export function getGraphStatus(projectId: string): GraphStatus {
  const state = readGraphIndexState(projectId);
  const indexing = getGraphIndexProgress(projectId);
  const nodeCount = countNodes(projectId);
  const indexed = state.lastIndexedAt != null && nodeCount > 0;
  return {
    projectId,
    indexed,
    lastIndexedAt: state.lastIndexedAt,
    fileCount: indexed ? countFileNodes(projectId) : state.fileCount,
    nodeCount,
    edgeCount: countEdges(projectId),
    durationMs: state.durationMs,
    confidenceBreakdown: state.confidenceBreakdown,
    staleFileCount: 0, // best-effort stale detection is a follow-up; 0 for now.
    indexing,
  };
}

/**
 * Entry points: file nodes whose path looks like an app/CLI/server entry. A
 * light heuristic for the brief's orientation — not exhaustive.
 */
const ENTRY_POINT_RE = /(^|\/)(main|index|server|app|cli|entry|routes?)\.(t|j)sx?$/i;

export function getGraphSummary(projectId: string): GraphSummary {
  const state = readGraphIndexState(projectId);
  const godNodes = topNodesByDegree(projectId, GRAPH_GOD_NODE_LIMIT, { excludeFiles: true }).map(
    toSummaryNode,
  );
  const entryFiles = topNodesByDegree(projectId, 200)
    .filter((n) => n.kind === "file" && ENTRY_POINT_RE.test(n.filePath))
    .slice(0, GRAPH_ENTRY_POINT_LIMIT)
    .map(toSummaryNode);
  return {
    fileCount: countFileNodes(projectId),
    nodeCount: countNodes(projectId),
    edgeCount: countEdges(projectId),
    lastIndexedAt: state.lastIndexedAt,
    godNodes,
    entryPoints: entryFiles,
  };
}

export function searchGraph(projectId: string, query: string, limit: number): GraphNodeView[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return searchNodes(projectId, trimmed, limit).map(toNodeView);
}

/** Resolve a node reference (id, exact name, or path/name substring) to a node. */
export function resolveNodeRef(projectId: string, ref: string): GraphNode | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const byId = getNodeById(projectId, trimmed);
  if (byId) return byId;
  const byName = findNodesByName(projectId, trimmed, 1);
  if (byName.length) return byName[0];
  const bySearch = searchNodes(projectId, trimmed, 1);
  return bySearch[0] ?? null;
}

export interface NeighborsResult {
  node: GraphNodeView;
  neighbors: GraphNeighbor[];
}

export function getNeighbors(
  projectId: string,
  ref: string,
  direction: GraphNeighborDirection,
  limit = GRAPH_NEIGHBORS_MAX,
): NeighborsResult | null {
  const node = resolveNodeRef(projectId, ref);
  if (!node) return null;

  const out: GraphNeighbor[] = [];
  const idsToHydrate = new Set<string>();
  const outEdges = direction === "in" ? [] : edgesFrom(projectId, node.id);
  const inEdges = direction === "out" ? [] : edgesTo(projectId, node.id);
  for (const e of outEdges) if (e.dstId) idsToHydrate.add(e.dstId);
  for (const e of inEdges) idsToHydrate.add(e.srcId);
  const hydrated = getNodesByIds(projectId, [...idsToHydrate]);

  for (const e of outEdges) {
    out.push({ edge: toEdgeView(e), node: e.dstId ? nodeViewOrNull(hydrated, e.dstId) : null, direction: "out" });
    if (out.length >= limit) break;
  }
  for (const e of inEdges) {
    if (out.length >= limit) break;
    out.push({ edge: toEdgeView(e), node: nodeViewOrNull(hydrated, e.srcId), direction: "in" });
  }
  return { node: toNodeView(node), neighbors: out };
}

export interface PathResult {
  from: GraphNodeView;
  to: GraphNodeView;
  nodes: GraphNodeView[];
  found: boolean;
}

/** BFS over resolved directed edges (src→dst), capped at GRAPH_PATH_MAX_DEPTH. */
export function getShortestPath(projectId: string, fromRef: string, toRef: string): PathResult | null {
  const from = resolveNodeRef(projectId, fromRef);
  const to = resolveNodeRef(projectId, toRef);
  if (!from || !to) return null;
  if (from.id === to.id) {
    const v = toNodeView(from);
    return { from: v, to: v, nodes: [v], found: true };
  }

  const prev = new Map<string, string>();
  const visited = new Set<string>([from.id]);
  let frontier = [from.id];
  let found = false;
  for (let depth = 0; depth < GRAPH_PATH_MAX_DEPTH && frontier.length && !found; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edgesFrom(projectId, id)) {
        if (!e.dstId || visited.has(e.dstId)) continue;
        visited.add(e.dstId);
        prev.set(e.dstId, id);
        if (e.dstId === to.id) {
          found = true;
          break;
        }
        next.push(e.dstId);
      }
      if (found) break;
    }
    frontier = next;
  }

  const chain: string[] = [];
  if (found) {
    let cur: string | undefined = to.id;
    while (cur) {
      chain.unshift(cur);
      if (cur === from.id) break;
      cur = prev.get(cur);
    }
  }
  const hydrated = getNodesByIds(projectId, chain);
  const nodes = chain.map((id) => hydrated.get(id)).filter((n): n is GraphNode => !!n).map(toNodeView);
  return { from: toNodeView(from), to: toNodeView(to), nodes, found };
}

export interface ImpactResult {
  node: GraphNodeView;
  dependents: GraphNodeView[];
  truncated: boolean;
}

/**
 * Transitive reverse-reachable dependents ("what breaks if I change this") —
 * BFS over incoming resolved edges, capped in breadth and depth.
 */
export function getImpact(projectId: string, ref: string): ImpactResult | null {
  const node = resolveNodeRef(projectId, ref);
  if (!node) return null;

  const visited = new Set<string>([node.id]);
  const dependents: string[] = [];
  let frontier = [node.id];
  let truncated = false;
  for (let depth = 0; depth < GRAPH_IMPACT_MAX_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edgesTo(projectId, id)) {
        if (visited.has(e.srcId)) continue;
        visited.add(e.srcId);
        dependents.push(e.srcId);
        next.push(e.srcId);
        if (dependents.length >= GRAPH_IMPACT_MAX_NODES) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
    frontier = next;
  }
  const hydrated = getNodesByIds(projectId, dependents);
  const nodes = dependents
    .map((id) => hydrated.get(id))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => b.degree - a.degree)
    .map(toNodeView);
  return { node: toNodeView(node), dependents: nodes, truncated };
}

function toEdgeView(e: GraphEdge) {
  return {
    id: e.id,
    projectId: e.projectId,
    srcId: e.srcId,
    dstId: e.dstId,
    dstName: e.dstName,
    kind: e.kind,
    confidence: e.confidence,
    createdAt: e.createdAt,
  };
}

function nodeViewOrNull(map: Map<string, GraphNode>, id: string): GraphNodeView | null {
  const n = map.get(id);
  return n ? toNodeView(n) : null;
}
