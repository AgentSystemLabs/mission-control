import { z } from "zod";
import {
  GRAPH_INDEX_MODES,
  GRAPH_SEARCH_LIMIT_DEFAULT,
  GRAPH_SEARCH_LIMIT_MAX,
} from "~/shared/code-graph";
import { projectExists } from "../repositories/projects.repo";
import {
  getGraphSummary,
  getGraphStatus,
  getImpact,
  getNeighbors,
  getShortestPath,
  searchGraph,
} from "../services/code-graph";
import { attachSearchSources, getNodeSource } from "../services/code-graph-source";
import { staleFilesAmong } from "../services/code-graph-staleness";
import {
  cancelGraphIndex,
  GraphIndexError,
  startGraphIndex,
} from "../services/code-graph-indexer";
import { rethrowUnlessDomain, json, jsonError, notFound, parseSearchParams } from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT } from "~/shared/http-status";

const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as unknown as [T, ...T[]]);

function requireProject(projectId: string): Response | null {
  return projectExists(projectId) ? null : notFound("project not found");
}

export async function status(projectId: string): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  return json({ status: getGraphStatus(projectId) });
}

export async function summary(projectId: string): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  return json({ summary: getGraphSummary(projectId) });
}

const indexQuery = z.object({ mode: enumOf(GRAPH_INDEX_MODES).optional() });

export async function index(projectId: string, url: URL): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const parsed = parseSearchParams(url, indexQuery);
  if (!parsed.ok) return parsed.response;
  try {
    const progress = startGraphIndex(projectId, parsed.data.mode ?? "full");
    return json({ status: getGraphStatus(projectId), job: progress }, { status: 202 });
  } catch (e) {
    if (e instanceof GraphIndexError) return jsonError(HTTP_BAD_REQUEST, e.message);
    return rethrowUnlessDomain(e);
  }
}

export async function cancelIndex(projectId: string): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const canceled = cancelGraphIndex(projectId);
  if (!canceled) return jsonError(HTTP_CONFLICT, "no index build is running");
  return json({ status: getGraphStatus(projectId) });
}

const searchQuery = z.object({
  q: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? "", 10);
      if (!Number.isFinite(n) || n <= 0) return GRAPH_SEARCH_LIMIT_DEFAULT;
      return Math.min(n, GRAPH_SEARCH_LIMIT_MAX);
    }),
  source: z.string().optional(),
});

export async function search(projectId: string, url: URL): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const parsed = parseSearchParams(url, searchQuery);
  if (!parsed.ok) return parsed.response;
  const nodes = searchGraph(projectId, parsed.data.q ?? "", parsed.data.limit);
  const withSource = parsed.data.source === "1" || parsed.data.source === "true";
  return json({
    nodes: withSource ? attachSearchSources(projectId, nodes) : nodes,
    staleFiles: staleFilesAmong(projectId, nodes.map((n) => n.filePath)),
  });
}

const nodeQuery = z.object({ node: z.string().min(1) });

/** A single resolved node with its verbatim (capped) definition source. */
export async function node(projectId: string, url: URL): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const parsed = parseSearchParams(url, nodeQuery);
  if (!parsed.ok) return parsed.response;
  const result = getNodeSource(projectId, parsed.data.node);
  if (!result) return notFound("node not found");
  return json({
    ...result,
    // Source is read live from disk, but the line RANGE came from the index —
    // a stale file means the range may be shifted.
    stale: staleFilesAmong(projectId, [result.node.filePath]).length > 0,
  });
}

const neighborsQuery = z.object({
  node: z.string().min(1),
  direction: z.enum(["in", "out", "both"]).optional(),
});

export async function neighbors(projectId: string, url: URL): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const parsed = parseSearchParams(url, neighborsQuery);
  if (!parsed.ok) return parsed.response;
  const result = getNeighbors(projectId, parsed.data.node, parsed.data.direction ?? "both");
  if (!result) return notFound("node not found");
  const paths = [
    result.node.filePath,
    ...result.neighbors.flatMap((nb) => (nb.node ? [nb.node.filePath] : [])),
  ];
  return json({ ...result, staleFiles: staleFilesAmong(projectId, paths) });
}

const pathQuery = z.object({ from: z.string().min(1), to: z.string().min(1) });

export async function path(projectId: string, url: URL): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const parsed = parseSearchParams(url, pathQuery);
  if (!parsed.ok) return parsed.response;
  const result = getShortestPath(projectId, parsed.data.from, parsed.data.to);
  if (!result) return notFound("node not found");
  return json({
    ...result,
    staleFiles: staleFilesAmong(projectId, result.nodes.map((n) => n.filePath)),
  });
}

const impactQuery = z.object({ node: z.string().min(1) });

export async function impact(projectId: string, url: URL): Promise<Response> {
  const missing = requireProject(projectId);
  if (missing) return missing;
  const parsed = parseSearchParams(url, impactQuery);
  if (!parsed.ok) return parsed.response;
  const result = getImpact(projectId, parsed.data.node);
  if (!result) return notFound("node not found");
  const paths = [result.node.filePath, ...result.dependents.map((n) => n.filePath)];
  return json({ ...result, staleFiles: staleFilesAmong(projectId, paths) });
}
