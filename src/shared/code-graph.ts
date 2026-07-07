// Shared types + constants for the Recall Code Graph — Mission Control's
// structural map of a project's source (symbols and the edges between them:
// imports, calls, defines). It answers questions grep can't ("what connects
// auth to the DB", "what breaks if I change this file", "what are the
// most-connected modules"), and is queried on demand by the agent via MCP.
//
// Kept framework-free so the server (indexer/repo/service), the renderer (api
// client / RecallPanel), and the standalone bundled MCP script can all import
// it without pulling in the DB or React layers. Mirrors the conventions of
// `project-memory.ts` (the memory pillar). See recall-phase4a-code-graph.md.

/**
 * Symbol kinds a node can represent. `file` is the container node (one per
 * source file, `name` = repo-relative path); the rest are declarations. Order
 * doubles as a rough display order.
 */
export const GRAPH_NODE_KINDS = [
  "file",
  "function",
  "class",
  "method",
  "interface",
  "type",
  "variable",
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

/**
 * Edge kinds. `defines` (file→symbol) and `imports` (file→module) are
 * structural; `calls` (symbol→symbol) and `references` (symbol→symbol) are
 * usage. Only `imports`/`calls`/`defines` are extracted in 4a; `references` is
 * reserved for 4b.
 */
export const GRAPH_EDGE_KINDS = ["imports", "calls", "defines", "references"] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

/**
 * How sure we are an edge points where we think it does.
 * `extracted` = read straight from the AST (a relative import resolved to the
 * target file, a `defines` edge). `inferred` = best-effort name resolution (a
 * call matched to a uniquely-named symbol). `ambiguous` = unresolved (a bare
 * package import kept as a name only, a call whose target name is duplicated or
 * unknown). Surfaced honestly in the UI and MCP replies.
 */
export const GRAPH_CONFIDENCES = ["extracted", "inferred", "ambiguous"] as const;
export type GraphConfidence = (typeof GRAPH_CONFIDENCES)[number];

/** Source language of a node, driving which tree-sitter grammar parsed it. */
export const GRAPH_LANGUAGES = ["ts", "tsx", "js", "jsx", "py"] as const;
export type GraphLanguage = (typeof GRAPH_LANGUAGES)[number];

/** Index build mode: cold `full` reparse vs `incremental` (changed files only). */
export const GRAPH_INDEX_MODES = ["full", "incremental"] as const;
export type GraphIndexMode = (typeof GRAPH_INDEX_MODES)[number];

/**
 * Phases of a build, in order, surfaced live in the panel's progress view.
 * `done`/`canceled`/`error` are terminal.
 */
export const GRAPH_INDEX_PHASES = [
  "enumerating",
  "parsing",
  "resolving",
  "writing",
  "ranking",
  "done",
  "canceled",
  "error",
] as const;
export type GraphIndexPhase = (typeof GRAPH_INDEX_PHASES)[number];

export type GraphNeighborDirection = "in" | "out" | "both";

// --- Enumeration / budget caps (no silent truncation — the indexer logs what
// it drops and the panel shows the skipped count with reasons). ---

/** Directories hard-skipped by the non-git fallback walk (git enumeration
 * already respects .gitignore). */
export const GRAPH_IGNORE_DIRS: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "vendor",
  "coverage",
  "dist-electron",
  // Python environments/caches — huge and never source.
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "site-packages",
  ".eggs",
];

/** Extensions the indexer parses (JS/TS variants share the js/ts grammars). */
export const GRAPH_SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".py",
];

/** Hard file-count ceiling for a single project (logged when hit, not silent). */
export const GRAPH_MAX_FILES = 6_000;
/** Skip files larger than this — minified/generated bundles, not source. */
export const GRAPH_MAX_FILE_BYTES = 1_000_000; // ~1 MB
/** Files committed per SQLite transaction during a build. */
export const GRAPH_WRITE_BATCH_FILES = 200;

/** Top-N most-connected nodes shown as "god nodes" in the panel. */
export const GRAPH_GOD_NODE_LIMIT = 10;
/** Fewer in the Session Brief's "Architecture at a glance" — budgeted. */
export const GRAPH_BRIEF_GOD_NODE_LIMIT = 8;
/** Cap on detected entry points surfaced in the summary. */
export const GRAPH_ENTRY_POINT_LIMIT = 8;

/** Safety caps for graph traversals so a query can never fan out unbounded. */
export const GRAPH_PATH_MAX_DEPTH = 12;
export const GRAPH_IMPACT_MAX_NODES = 250;
export const GRAPH_IMPACT_MAX_DEPTH = 8;
export const GRAPH_NEIGHBORS_MAX = 200;
export const GRAPH_SEARCH_LIMIT_DEFAULT = 30;
export const GRAPH_SEARCH_LIMIT_MAX = 100;

// --- Verbatim-source hydration (graph/node + graph/search?source=1). The
// graph stores each symbol's line range, so queries can return the definition
// body itself and spare the agent a follow-up file read. Caps keep a single
// response bounded no matter how large the symbol or result set. ---

/** Max source lines returned for a single node (`graph/node`). */
export const GRAPH_SOURCE_MAX_LINES = 200;
/** Tighter per-node cap when source is inlined into search results. */
export const GRAPH_SOURCE_SEARCH_MAX_LINES = 60;
/** Only the top-N search hits get source inlined; the rest stay location-only. */
export const GRAPH_SOURCE_SEARCH_MAX_NODES = 5;

/** Map a repo-relative path to the grammar language, or null if not a source file. */
export function languageForFile(relPath: string): GraphLanguage | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  if (lower.endsWith(".py")) return "py";
  return null;
}

/** Whether a path is one of the source extensions we index. */
export function isGraphSourceFile(relPath: string): boolean {
  return languageForFile(relPath) !== null;
}

export function isGraphNodeKind(value: unknown): value is GraphNodeKind {
  return typeof value === "string" && (GRAPH_NODE_KINDS as readonly string[]).includes(value);
}

export function isGraphEdgeKind(value: unknown): value is GraphEdgeKind {
  return typeof value === "string" && (GRAPH_EDGE_KINDS as readonly string[]).includes(value);
}

/** Human labels per node kind, for the panel + rendered brief. */
export const GRAPH_NODE_KIND_LABELS: Record<GraphNodeKind, string> = {
  file: "File",
  function: "Function",
  class: "Class",
  method: "Method",
  interface: "Interface",
  type: "Type",
  variable: "Variable",
};

// --- Client-facing shapes (structural, not Drizzle-derived, so they import
// anywhere). The server maps DB rows to these before responding. ---

export interface GraphNodeView {
  id: string;
  projectId: string;
  kind: GraphNodeKind;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  signature: string | null;
  language: GraphLanguage;
  degree: number;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdgeView {
  id: string;
  projectId: string;
  srcId: string;
  dstId: string | null;
  /** Unresolved target name (external/package import, unresolved call). */
  dstName: string | null;
  kind: GraphEdgeKind;
  confidence: GraphConfidence;
  createdAt: number;
}

/**
 * A verbatim slice of a node's source, read from disk at query time (never
 * stored). `endLine` is the last line actually included — when the symbol
 * continues past a cap, `truncated` is true and the reader should open the
 * file for the rest.
 */
export interface GraphNodeSource {
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

/** A search hit optionally hydrated with its definition source. */
export interface GraphNodeViewWithSource extends GraphNodeView {
  source: GraphNodeSource | null;
}

/**
 * One step out from a node: the edge plus the resolved neighbor node (null when
 * the edge points at an external/unresolved target — read `edge.dstName` then).
 */
export interface GraphNeighbor {
  edge: GraphEdgeView;
  node: GraphNodeView | null;
  direction: "in" | "out";
}

/** A compact god-node / entry-point row for the summary + brief. */
export interface GraphSummaryNode {
  id: string;
  name: string;
  kind: GraphNodeKind;
  filePath: string;
  startLine: number;
  degree: number;
}

/** God-nodes + entry points for the brief and the panel's indexed state. */
export interface GraphSummary {
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  lastIndexedAt: number | null;
  godNodes: GraphSummaryNode[];
  entryPoints: GraphSummaryNode[];
}

/** Live progress of an in-flight build (present only while one runs). */
export interface GraphIndexProgress {
  jobId: string;
  mode: GraphIndexMode;
  phase: GraphIndexPhase;
  filesDone: number;
  filesTotal: number;
  nodes: number;
  edges: number;
  skipped: number;
  /** File currently being parsed (repo-relative), or null between phases. */
  currentFile: string | null;
  startedAt: number;
  error: string | null;
}

/** Reason a file was skipped, for the "what's happening" panel view. */
export interface GraphSkippedFile {
  path: string;
  reason: "too-large" | "minified" | "unreadable" | "over-cap";
}

/**
 * Whole-graph status for the panel. `indexing` is populated only while a build
 * runs (so a reopened panel reconnects to the live job); `staleFileCount` is a
 * best-effort count of tracked files changed since the last successful index.
 */
export interface GraphStatus {
  projectId: string;
  indexed: boolean;
  lastIndexedAt: number | null;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number | null;
  confidenceBreakdown: Record<GraphConfidence, number>;
  staleFileCount: number;
  indexing: GraphIndexProgress | null;
}

/**
 * Version of the on-disk graph data the indexer writes. Bumped when the row
 * shapes change in a way incremental updates can't heal (e.g. `dst_name` now
 * populated on resolved edges, file hashes moved to `graph_files`); a persisted
 * state with an older version forces a one-time full rebuild instead of a data
 * migration.
 */
export const GRAPH_INDEX_SCHEMA_VERSION = 2;

/**
 * Persisted index state (a JSON row in `app_settings`, key
 * `code_graph_state:<projectId>`). Per-file stats/hashes driving incremental
 * re-index live in the `graph_files` table (legacy states carried them inline
 * as `fileHashes`).
 */
export interface GraphIndexState {
  lastIndexedAt: number | null;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  durationMs: number | null;
  lastMode: GraphIndexMode | null;
  confidenceBreakdown: Record<GraphConfidence, number>;
  /** Legacy (pre-`graph_files`) repo-relative path → content hash. */
  fileHashes: Record<string, string>;
  /**
   * GRAPH_INDEX_SCHEMA_VERSION at last successful build; 0 = written by a
   * build that predates versioning. A mismatch forces a full rebuild.
   */
  schemaVersion: number;
  /** Files actually re-parsed by the last build (observability + tests). */
  lastParsedCount: number;
}

export function emptyConfidenceBreakdown(): Record<GraphConfidence, number> {
  return { extracted: 0, inferred: 0, ambiguous: 0 };
}

export function emptyGraphIndexState(): GraphIndexState {
  return {
    lastIndexedAt: null,
    fileCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    durationMs: null,
    lastMode: null,
    confidenceBreakdown: emptyConfidenceBreakdown(),
    fileHashes: {},
    // Deliberately 0, NOT the current version: states persisted before
    // versioning must read back as outdated so the next build runs full.
    schemaVersion: 0,
    lastParsedCount: 0,
  };
}

/** The `app_settings` key holding a project's persisted index state. */
export function graphIndexStateKey(projectId: string): string {
  return `code_graph_state:${projectId}`;
}
