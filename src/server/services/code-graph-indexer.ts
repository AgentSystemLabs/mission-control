// The code-graph build job. Orchestrates: enumerate → parse/extract → resolve
// edges → commit → rank → persist, as a cancelable background job with throttled
// `graph:index-progress` SSE. Only ONE job runs per project (idempotent start).
//
// Execution model (see recall-phase4a-code-graph.md):
//  - Parsing is the long, CPU-bound phase; it yields to the event loop between
//    files so the server's request loop stays responsive during a big build
//    (the plan's sanctioned "batched-async with yields" alternative to a worker
//    thread — kept in-process so it rides the single SSR bundle).
//  - Extractions are buffered in memory and only committed transactionally at
//    the end, so canceling (or an app quit) mid-parse leaves the PRIOR graph
//    intact rather than a half-built one. Incremental re-index (changed files
//    only, by content hash) makes the re-run after an interrupt cheap.

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Parser } from "web-tree-sitter";
import {
  GRAPH_INDEX_SCHEMA_VERSION,
  GRAPH_MAX_FILES,
  languageForFile,
  type GraphConfidence,
  type GraphIndexMode,
  type GraphIndexProgress,
  type GraphIndexState,
  type GraphLanguage,
} from "~/shared/code-graph";
import type { NewGraphEdge, NewGraphFile, NewGraphNode } from "~/db/schema";
import { findProjectById } from "../repositories/projects.repo";
import { events } from "../events";
import { newId } from "./_ids";
import { enumerateSourceFiles } from "./code-graph-enumerate";
import { extractFromTree, type FileExtraction } from "./code-graph-extract";
import { getGraphParser } from "./code-graph-wasm";
import {
  confidenceBreakdown,
  countEdges,
  countFileNodes,
  countNodes,
  deleteGraphForProject,
  insertGraphEdges,
  insertGraphNodes,
  listDanglingCallEdges,
  listDanglingImportEdges,
  listNodeIndex,
  pruneGraphForFiles,
  readGraphFileStats,
  readGraphIndexState,
  recomputeDegrees,
  replaceGraphFileStats,
  resolveDanglingEdges,
  updateGraphFileStats,
  writeGraphIndexState,
  type GraphFileStat,
} from "../repositories/code-graph.repo";

export class GraphIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphIndexError";
  }
}

interface IndexJob {
  progress: GraphIndexProgress;
  canceled: boolean;
  promise: Promise<void>;
}

const runningJobs = new Map<string, IndexJob>();

const PROGRESS_THROTTLE_MS = 200;
/** Concurrent file reads per batch in the hash phase — batch boundaries are
 * the event-loop yield points. */
const READ_BATCH = 8;

export function getGraphIndexProgress(projectId: string): GraphIndexProgress | null {
  return runningJobs.get(projectId)?.progress ?? null;
}

export function isGraphIndexRunning(projectId: string): boolean {
  return runningJobs.has(projectId);
}

export function cancelGraphIndex(projectId: string): boolean {
  const job = runningJobs.get(projectId);
  if (!job) return false;
  job.canceled = true;
  return true;
}

/**
 * Start (or return the in-flight) build for a project. Returns the current
 * progress snapshot immediately; the build runs in the background.
 */
export function startGraphIndex(projectId: string, mode: GraphIndexMode): GraphIndexProgress {
  const existing = runningJobs.get(projectId);
  if (existing) return existing.progress;

  const project = findProjectById(projectId);
  if (!project) throw new GraphIndexError("project not found");
  if (project.sandboxId) {
    // The embedded server reads files on the host FS; a sandboxed project's
    // source lives in its container. Local-only for 4a (matches MCP delivery).
    throw new GraphIndexError("code graph indexing is available for local projects only");
  }
  const root = path.resolve(project.path);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new GraphIndexError("project path does not exist on disk");
  }

  const progress: GraphIndexProgress = {
    jobId: newId("gj"),
    mode,
    phase: "enumerating",
    filesDone: 0,
    filesTotal: 0,
    nodes: 0,
    edges: 0,
    skipped: 0,
    currentFile: null,
    startedAt: Date.now(),
    error: null,
  };
  const job: IndexJob = { progress, canceled: false, promise: Promise.resolve() };
  runningJobs.set(projectId, job);
  job.promise = runBuild(projectId, root, mode, job).finally(() => {
    runningJobs.delete(projectId);
  });
  return progress;
}

function emitProgress(projectId: string, job: IndexJob, force = false): void {
  const now = Date.now();
  const anyJob = job as IndexJob & { _lastEmit?: number };
  if (!force && anyJob._lastEmit && now - anyJob._lastEmit < PROGRESS_THROTTLE_MS) return;
  anyJob._lastEmit = now;
  events.emit("graph:index-progress", { projectId, progress: { ...job.progress } });
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// How many items the commit-region pure-JS loops process between event-loop
// yields. Small enough to keep per-slice work well under a frame, large enough
// that the setImmediate overhead stays negligible on big indexes.
const COMMIT_YIELD_EVERY = 500;

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

/**
 * Collision-free id generator for a single build. A build inserts tens of
 * thousands of node/edge rows in the same millisecond — far more than newId()'s
 * `randomBytes(3)` suffix can keep unique (birthday collisions are near-certain
 * past a few thousand rows). A per-build random tag + a monotonic counter makes
 * every id unique by construction.
 */
function makeIdGen(): (prefix: string) => string {
  const tag = randomBytes(6).toString("hex");
  let seq = 0;
  return (prefix: string) => `${prefix}-${tag}-${(seq++).toString(36)}`;
}

async function runBuild(
  projectId: string,
  root: string,
  requestedMode: GraphIndexMode,
  job: IndexJob,
): Promise<void> {
  const { progress } = job;
  const nextId = makeIdGen();
  try {
    // --- 1. Enumerate ---
    const enumeration = await enumerateSourceFiles(root);
    progress.filesTotal = enumeration.files.length;
    progress.skipped = enumeration.skipped.length;
    if (enumeration.cappedAtLimit) {
      console.warn(
        `[code-graph] ${projectId}: file cap hit — indexing ${GRAPH_MAX_FILES} of ${enumeration.files.length + enumeration.skipped.length} files`,
      );
    }
    emitProgress(projectId, job, true);
    if (job.canceled) return finishCanceled(projectId, job);

    const priorState = readGraphIndexState(projectId);
    // Graph rows written under an older on-disk shape can't be healed
    // incrementally (e.g. resolved edges without dst_name) — rebuild once.
    const mode: GraphIndexMode =
      requestedMode === "incremental" && priorState.schemaVersion !== GRAPH_INDEX_SCHEMA_VERSION
        ? "full"
        : requestedMode;
    if (mode !== requestedMode) {
      progress.mode = mode;
      console.warn(
        `[code-graph] ${projectId}: graph schema v${priorState.schemaVersion} → v${GRAPH_INDEX_SCHEMA_VERSION}; forcing a full rebuild`,
      );
    }
    // Legacy states carried hashes inline (no stat info); the graph_files
    // table is authoritative now, but the legacy hashes still gate parsing
    // once so the first post-upgrade pass isn't a full re-parse.
    const legacyHashes = mode === "full" ? {} : priorState.fileHashes;
    const priorStats =
      mode === "full" ? new Map<string, GraphFileStat>() : readGraphFileStats(projectId);

    // --- 2. Stat-gate + hash: a file whose (size, mtime) matches its stored
    // row is trusted unread; only moved files are read (async, small batches,
    // so a watcher-triggered pass never blocks the event loop) and only files
    // whose content hash actually changed are parsed. Same-size same-mtime
    // edits are invisible to the fastpath — the acknowledged make(1)-style
    // tradeoff; a manual Rebuild always covers it.
    const currentStats = new Map<string, GraphFileStat>();
    const statUpserts: NewGraphFile[] = [];
    const contentByPath = new Map<string, { language: GraphLanguage; source: string }>();
    const filesToParse: string[] = [];
    for (let i = 0; i < enumeration.files.length; i += READ_BATCH) {
      if (job.canceled) return finishCanceled(projectId, job);
      const batch = enumeration.files.slice(i, i + READ_BATCH);
      const loaded = await Promise.all(
        batch.map(async (file) => {
          const language = languageForFile(file.path);
          if (!language) return null;
          const prior = priorStats.get(file.path);
          if (prior && prior.size === file.size && prior.mtimeMs === file.mtimeMs) {
            return { file, language, source: null as string | null, stat: prior };
          }
          let source: string;
          try {
            source = await fsp.readFile(path.join(root, file.path), "utf8");
          } catch {
            return null;
          }
          const stat: GraphFileStat = {
            size: file.size,
            mtimeMs: file.mtimeMs,
            hash: hashContent(source),
          };
          return { file, language, source: source as string | null, stat };
        }),
      );
      for (const got of loaded) {
        if (!got) continue;
        currentStats.set(got.file.path, got.stat);
        if (got.source === null) continue; // stat fastpath — unchanged, no parse
        statUpserts.push({
          projectId,
          path: got.file.path,
          size: got.stat.size,
          mtimeMs: got.stat.mtimeMs,
          hash: got.stat.hash,
        });
        const priorHash = priorStats.get(got.file.path)?.hash ?? legacyHashes[got.file.path];
        if (mode === "full" || priorHash !== got.stat.hash) {
          filesToParse.push(got.file.path);
          contentByPath.set(got.file.path, { language: got.language, source: got.source });
        }
      }
    }
    const priorPaths =
      mode === "full"
        ? []
        : [...new Set([...priorStats.keys(), ...Object.keys(legacyHashes)])];
    const removedFiles = priorPaths.filter((p) => !currentStats.has(p));

    // --- 3. Parse/extract (cancelable, memory-buffered) ---
    progress.phase = "parsing";
    emitProgress(projectId, job, true);
    const parsers = new Map<GraphLanguage, Parser>();
    const extractions = new Map<string, { language: GraphLanguage; extraction: FileExtraction }>();
    try {
      for (const rel of filesToParse) {
        if (job.canceled) {
          for (const p of parsers.values()) p.delete();
          return finishCanceled(projectId, job);
        }
        const entry = contentByPath.get(rel)!;
        let parser = parsers.get(entry.language);
        if (!parser) {
          parser = await getGraphParser(entry.language);
          parsers.set(entry.language, parser);
        }
        progress.currentFile = rel;
        const tree = parser.parse(entry.source);
        if (tree) {
          try {
            const extraction = extractFromTree(tree.rootNode, entry.language);
            extractions.set(rel, { language: entry.language, extraction });
            progress.nodes += extraction.symbols.length + 1; // +1 for the file node
          } finally {
            tree.delete();
          }
        }
        progress.filesDone += 1;
        emitProgress(projectId, job);
        await yieldToLoop();
      }
    } finally {
      for (const p of parsers.values()) p.delete();
    }

    // --- 4. Commit: delete stale, insert nodes, resolve edges, insert edges ---
    progress.phase = "writing";
    progress.currentFile = null;
    emitProgress(projectId, job, true);
    const now = Date.now();

    if (mode === "full") {
      deleteGraphForProject(projectId);
    } else {
      // Deletes changed files' nodes + outgoing edges; DETACHES (keeps by
      // name) inbound edges from unchanged files so re-resolution below can
      // re-attach them to the freshly inserted nodes.
      pruneGraphForFiles(projectId, [...filesToParse, ...removedFiles]);
    }

    // Build node rows + a local (relPath → { fileNodeId, symbolIds[] }) map.
    // The commit region below holds no transaction open across these pure-JS
    // loops (each repo write owns its own transaction), so we yield to the event
    // loop periodically to keep /api/* responsive while a large index commits.
    const nodeRows: NewGraphNode[] = [];
    const localFile = new Map<string, { fileNodeId: string; symbolIds: string[] }>();
    let nodeBuildCount = 0;
    for (const rel of filesToParse) {
      if (++nodeBuildCount % COMMIT_YIELD_EVERY === 0) await yieldToLoop();
      const got = extractions.get(rel);
      if (!got) continue;
      const { language, extraction } = got;
      const fileNodeId = nextId("gn");
      nodeRows.push({
        id: fileNodeId,
        projectId,
        kind: "file",
        name: rel,
        filePath: rel,
        startLine: 1,
        endLine: 1,
        exported: false,
        signature: null,
        language,
        degree: 0,
        createdAt: now,
        updatedAt: now,
      });
      const symbolIds: string[] = [];
      for (const sym of extraction.symbols) {
        const id = nextId("gn");
        symbolIds[sym.index] = id;
        nodeRows.push({
          id,
          projectId,
          kind: sym.kind,
          name: sym.name,
          filePath: rel,
          startLine: sym.startLine,
          endLine: sym.endLine,
          exported: sym.exported,
          signature: sym.signature,
          language,
          degree: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      localFile.set(rel, { fileNodeId, symbolIds });
    }
    insertGraphNodes(nodeRows);
    if (job.canceled) return finishCanceled(projectId, job);

    // Full-project resolution index (reflects unchanged + newly inserted nodes).
    interface Candidate {
      id: string;
      filePath: string;
      exported: boolean;
    }
    const nameToCandidates = new Map<string, Candidate[]>();
    const fileNodeIdByPath = new Map<string, string>();
    let candidateBuildCount = 0;
    for (const n of listNodeIndex(projectId)) {
      if (++candidateBuildCount % COMMIT_YIELD_EVERY === 0) await yieldToLoop();
      if (n.kind === "file") {
        fileNodeIdByPath.set(n.filePath, n.id);
      } else {
        const cand: Candidate = { id: n.id, filePath: n.filePath, exported: n.exported };
        const list = nameToCandidates.get(n.name);
        if (list) list.push(cand);
        else nameToCandidates.set(n.name, [cand]);
      }
    }
    // Resolve a call to a target node id (inferred), preferring a same-file
    // definition, then a UNIQUE exported one. A non-exported local of the same
    // name in another file is NOT a match (keeps ubiquitous names like
    // `describe` from becoming false hubs). Cross-file MEMBER calls (`x.set()`)
    // are never name-resolved — we don't track receiver types, so guessing
    // `.set`/`.get`/`.has` by name produces false hubs; only a same-file method
    // of that name is accepted. null → ambiguous/external.
    const resolveCall = (calleeName: string, callerFile: string, isMember: boolean): string | null => {
      const candidates = nameToCandidates.get(calleeName);
      if (!candidates || !candidates.length) return null;
      const sameFile = candidates.filter((c) => c.filePath === callerFile);
      if (sameFile.length) return sameFile[0].id;
      if (isMember) return null;
      const exported = candidates.filter((c) => c.exported);
      return exported.length === 1 ? exported[0].id : null;
    };
    const fileSet = new Set(currentStats.keys());
    const aliasMap = readTsconfigAliases(root);

    // Resolve edges for the (re)parsed files. `dstName` is ALWAYS kept on
    // imports/calls (even when resolved) so a later incremental pass can
    // detach an edge from a re-created node and re-resolve it by name.
    const edgeRows: NewGraphEdge[] = [];
    const seenEdge = new Set<string>();
    const addEdge = (
      srcId: string,
      kind: NewGraphEdge["kind"],
      dstId: string | null,
      dstName: string | null,
      confidence: GraphConfidence,
      isMember = false,
    ) => {
      const key = `${srcId}|${kind}|${dstId ?? "?"}|${dstName ?? ""}`;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      edgeRows.push({
        id: nextId("ge"),
        projectId,
        srcId,
        dstId,
        dstName,
        kind,
        confidence,
        isMember,
        createdAt: now,
      });
    };

    let edgeBuildCount = 0;
    for (const rel of filesToParse) {
      if (++edgeBuildCount % COMMIT_YIELD_EVERY === 0) await yieldToLoop();
      const got = extractions.get(rel);
      const local = localFile.get(rel);
      if (!got || !local) continue;
      const { fileNodeId, symbolIds } = local;
      // defines: file → each symbol (same-file only, so never dangles by name)
      for (const id of symbolIds) {
        if (id) addEdge(fileNodeId, "defines", id, null, "extracted");
      }
      // imports
      for (const imp of got.extraction.imports) {
        const targetRel = resolveImport(imp.spec, rel, aliasMap, fileSet);
        const dstId = targetRel ? fileNodeIdByPath.get(targetRel) ?? null : null;
        if (dstId) addEdge(fileNodeId, "imports", dstId, imp.spec, "extracted");
        else addEdge(fileNodeId, "imports", null, imp.spec, "ambiguous");
      }
      // calls
      for (const call of got.extraction.calls) {
        const srcId =
          call.enclosingIndex != null ? symbolIds[call.enclosingIndex] ?? fileNodeId : fileNodeId;
        const targetId = resolveCall(call.calleeName, rel, call.isMember);
        if (targetId) {
          addEdge(srcId, "calls", targetId, call.calleeName, "inferred", call.isMember);
        } else {
          addEdge(srcId, "calls", null, call.calleeName, "ambiguous", call.isMember);
        }
      }
    }
    insertGraphEdges(edgeRows);
    progress.edges = edgeRows.length;
    if (job.canceled) return finishCanceled(projectId, job);

    // --- 4b. Re-resolve dangling edges (incremental only) ---
    // Edges detached by pruneGraphForFiles — plus older never-resolved ones
    // whose target name just (re)appeared — point at nothing but still carry
    // `dst_name`. Re-attach them against the fresh node index. Bounded: calls
    // are only fetched for symbol names inserted THIS pass (an edge can only
    // newly resolve if its target name just appeared); imports only for
    // internal-looking specs. A name that became unique because its duplicate
    // was deleted is NOT healed here — the next full index covers that.
    if (mode === "incremental" && (filesToParse.length || removedFiles.length)) {
      const edgeUpdates: Array<{ id: string; dstId: string; confidence: GraphConfidence }> = [];
      const insertedSymbolNames = new Set<string>();
      for (const row of nodeRows) {
        if (row.kind !== "file") insertedSymbolNames.add(row.name);
      }
      if (insertedSymbolNames.size) {
        for (const e of listDanglingCallEdges(projectId, [...insertedSymbolNames])) {
          if (!e.srcFilePath) continue;
          const targetId = resolveCall(e.dstName, e.srcFilePath, e.isMember);
          if (targetId) edgeUpdates.push({ id: e.id, dstId: targetId, confidence: "inferred" });
        }
      }
      const specPrefixes = [".", ...aliasMap.map((a) => a.prefix)];
      for (const e of listDanglingImportEdges(projectId, specPrefixes)) {
        if (!e.srcFilePath) continue;
        const targetRel = resolveImport(e.dstName, e.srcFilePath, aliasMap, fileSet);
        const dstId = targetRel ? fileNodeIdByPath.get(targetRel) ?? null : null;
        if (dstId) edgeUpdates.push({ id: e.id, dstId, confidence: "extracted" });
      }
      resolveDanglingEdges(edgeUpdates);
    }
    if (job.canceled) return finishCanceled(projectId, job);

    // Persist the per-file stat/hash index alongside the graph rows it
    // describes (still inside the "commit region" — a cancel above leaves the
    // prior graph AND prior file index intact together).
    if (mode === "full") {
      replaceGraphFileStats(projectId, statUpserts);
    } else {
      updateGraphFileStats(projectId, statUpserts, removedFiles);
    }

    // --- 5. Rank + persist ---
    progress.phase = "ranking";
    emitProgress(projectId, job, true);
    recomputeDegrees(projectId);

    const finalNodeCount = countNodes(projectId);
    const finalEdgeCount = countEdges(projectId);
    const finalFileCount = countFileNodes(projectId);
    const breakdown = confidenceBreakdown(projectId);
    const durationMs = Date.now() - progress.startedAt;
    const state: GraphIndexState = {
      lastIndexedAt: now,
      fileCount: finalFileCount,
      nodeCount: finalNodeCount,
      edgeCount: finalEdgeCount,
      durationMs,
      lastMode: mode,
      confidenceBreakdown: breakdown,
      // Hashes live in graph_files now; written empty so legacy states shrink.
      fileHashes: {},
      schemaVersion: GRAPH_INDEX_SCHEMA_VERSION,
      lastParsedCount: filesToParse.length,
    };
    writeGraphIndexState(projectId, state);

    progress.phase = "done";
    progress.nodes = finalNodeCount;
    progress.edges = finalEdgeCount;
    emitProgress(projectId, job, true);
    events.emit("graph:indexed", {
      projectId,
      ok: true,
      nodeCount: finalNodeCount,
      edgeCount: finalEdgeCount,
    });
  } catch (err) {
    progress.phase = "error";
    progress.error = err instanceof Error ? err.message : String(err);
    emitProgress(projectId, job, true);
    console.error(`[code-graph] build failed for ${projectId}:`, err);
    events.emit("graph:indexed", { projectId, ok: false, nodeCount: 0, edgeCount: 0 });
  }
}

function finishCanceled(projectId: string, job: IndexJob): void {
  job.progress.phase = "canceled";
  job.progress.currentFile = null;
  emitProgress(projectId, job, true);
  events.emit("graph:indexed", { projectId, ok: false, nodeCount: 0, edgeCount: 0 });
}

// --- Import resolution ---

type AliasMap = Array<{ prefix: string; targets: string[] }>;

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

function readTsconfigAliases(root: string): AliasMap {
  const out: AliasMap = [];
  const tsconfigPath = path.join(root, "tsconfig.json");
  let raw: string;
  try {
    raw = fs.readFileSync(tsconfigPath, "utf8");
  } catch {
    return out;
  }
  let json: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    // Most tsconfigs are valid JSON; only fall back to comment-stripping (JSONC)
    // if a straight parse fails.
    json = JSON.parse(raw);
  } catch {
    try {
      json = JSON.parse(stripJsonComments(raw));
    } catch {
      return out;
    }
  }
  const baseUrl = json.compilerOptions?.baseUrl ?? ".";
  const paths = json.compilerOptions?.paths ?? {};
  for (const [key, values] of Object.entries(paths)) {
    if (!key.endsWith("/*")) continue; // only wildcard aliases in the MVP
    const prefix = key.slice(0, -1); // "~/*" → "~/"
    const targets = values
      .filter((v) => v.endsWith("/*"))
      .map((v) => {
        const rel = v.slice(0, -1).replace(/^\.\//, ""); // "./src/*" → "src/"
        return posixJoin(baseUrl.replace(/^\.\/?/, ""), rel).replace(/^\/+/, "");
      });
    if (targets.length) out.push({ prefix, targets });
  }
  return out;
}

/** Strip `//` and `/* */` comments (JSONC), skipping comment-like text inside
 * string literals — a naive regex would treat `/*` in `"~/*"` as a comment. */
function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const n = input[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && n === "/") {
      inLine = true;
      i++;
    } else if (c === "/" && n === "*") {
      inBlock = true;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

function posixJoin(...parts: string[]): string {
  return path.posix.normalize(parts.filter(Boolean).join("/"));
}

/** Resolve a module specifier to a repo-relative source file, or null if external. */
function resolveImport(
  spec: string,
  fromRel: string,
  aliasMap: AliasMap,
  fileSet: Set<string>,
): string | null {
  // Python modules are dotted paths, not file specifiers — separate resolver.
  if (fromRel.endsWith(".py")) return resolvePythonImport(spec, fromRel, fileSet);

  let baseRel: string | null = null;
  if (spec.startsWith(".")) {
    baseRel = posixJoin(path.posix.dirname(fromRel), spec);
  } else {
    for (const { prefix, targets } of aliasMap) {
      if (spec.startsWith(prefix)) {
        const rest = spec.slice(prefix.length);
        baseRel = posixJoin(targets[0], rest);
        break;
      }
    }
  }
  if (baseRel === null) return null; // bare/package import → external
  baseRel = baseRel.replace(/^\.\//, "");

  const candidates: string[] = [];
  const pushExtVariants = (base: string) => {
    if (RESOLVE_EXTS.some((e) => base.endsWith(e)) && fileSet.has(base)) candidates.push(base);
    // TS ESM often writes `./x.js` (or `.mjs`/`.cjs`) for a `./x.ts` source.
    const jsToTs = base.replace(/\.[mc]?js$/, "");
    for (const e of RESOLVE_EXTS) candidates.push(base + e, `${base}/index${e}`, jsToTs + e);
  };
  pushExtVariants(baseRel);
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

/**
 * Resolve a Python module spec (`pkg.mod`, `.sibling`, `..pkg`) to a repo-relative
 * `.py` file. Relative specs anchor at the importing file's package (one leading
 * dot) and climb one directory per extra dot; absolute specs are tried against
 * the repo root and the common `src/` layout (a sys.path approximation — bare
 * library imports simply won't match and stay external/ambiguous).
 */
function resolvePythonImport(spec: string, fromRel: string, fileSet: Set<string>): string | null {
  let rest = spec;
  let dots = 0;
  while (rest.startsWith(".")) {
    dots++;
    rest = rest.slice(1);
  }
  const segs = rest ? rest.split(".") : [];
  const bases: string[] = [];
  if (dots > 0) {
    let dir = path.posix.dirname(fromRel);
    for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
    bases.push([dir === "." ? "" : dir, ...segs].filter(Boolean).join("/"));
  } else if (segs.length) {
    bases.push(segs.join("/"), ["src", ...segs].join("/"));
  }
  for (const base of bases) {
    const candidates = base ? [`${base}.py`, `${base}/__init__.py`] : ["__init__.py"];
    for (const c of candidates) {
      if (fileSet.has(c)) return c;
    }
  }
  return null;
}
