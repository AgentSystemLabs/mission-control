// Verbatim-source hydration for code-graph queries: given a node's stored line
// range, read the definition body from disk so graph_node / graph_search can
// return the code itself instead of just a location — sparing the agent the
// follow-up file read. Source is read at query time (never persisted), capped
// per node and per response, and degrades to location-only (source: null) when
// the project is sandboxed or the file is gone/moved since the last index.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  GRAPH_MAX_FILE_BYTES,
  GRAPH_SOURCE_MAX_LINES,
  GRAPH_SOURCE_SEARCH_MAX_LINES,
  GRAPH_SOURCE_SEARCH_MAX_NODES,
  type GraphNodeSource,
  type GraphNodeView,
  type GraphNodeViewWithSource,
} from "~/shared/code-graph";
import { findProjectById } from "../repositories/projects.repo";
import { resolveNodeRef, toNodeView } from "./code-graph";

/**
 * The on-disk root source is read from, or null when there isn't one (project
 * gone, sandboxed — files live remotely — or path missing on disk).
 */
export function resolveGraphSourceRoot(projectId: string): string | null {
  const project = findProjectById(projectId);
  if (!project || project.sandboxId) return null;
  const root = path.resolve(project.path);
  return fs.existsSync(root) ? root : null;
}

/**
 * Read a node's source slice from disk. File nodes (stored as startLine 1 /
 * endLine 1) read from the top of the file; symbol nodes read their recorded
 * range. Returns null when the file is unreadable, oversized, or its path
 * escapes the project root (a stale or corrupt row must never become an
 * arbitrary-file read).
 */
export function readNodeSource(
  root: string,
  node: Pick<GraphNodeView, "kind" | "filePath" | "startLine" | "endLine">,
  maxLines: number,
): GraphNodeSource | null {
  const abs = path.resolve(root, node.filePath);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;

  let text: string;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > GRAPH_MAX_FILE_BYTES) return null;
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }

  const lines = text.split("\n");
  // A trailing newline yields one phantom empty element — don't count it.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const startLine = node.kind === "file" ? 1 : Math.max(1, node.startLine);
  const intendedEnd =
    node.kind === "file" ? lines.length : Math.min(Math.max(node.endLine, startLine), lines.length);
  if (startLine > lines.length) return null; // range fell off the end — stale index
  const endLine = Math.min(intendedEnd, startLine + maxLines - 1);

  return {
    text: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
    truncated: endLine < intendedEnd,
  };
}

/**
 * Hydrate search hits with their definition source: the top
 * GRAPH_SOURCE_SEARCH_MAX_NODES nodes get a capped slice, the rest stay
 * location-only. All-null when the project has no readable root.
 */
export function attachSearchSources(
  projectId: string,
  nodes: GraphNodeView[],
): GraphNodeViewWithSource[] {
  const root = resolveGraphSourceRoot(projectId);
  return nodes.map((node, i) => ({
    ...node,
    source:
      root && i < GRAPH_SOURCE_SEARCH_MAX_NODES
        ? readNodeSource(root, node, GRAPH_SOURCE_SEARCH_MAX_LINES)
        : null,
  }));
}

export interface NodeSourceResult {
  node: GraphNodeView;
  source: GraphNodeSource | null;
}

/** Resolve a node reference and read its (capped) definition source. */
export function getNodeSource(projectId: string, ref: string): NodeSourceResult | null {
  const node = resolveNodeRef(projectId, ref);
  if (!node) return null;
  const root = resolveGraphSourceRoot(projectId);
  return {
    node: toNodeView(node),
    source: root ? readNodeSource(root, node, GRAPH_SOURCE_MAX_LINES) : null,
  };
}
