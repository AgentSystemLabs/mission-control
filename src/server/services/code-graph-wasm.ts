// web-tree-sitter loader for the code-graph indexer. Loads the grammar `.wasm`
// files (bundled as assets — dev vs packaged path resolution mirrors
// bundled-skills-path.ts / whisper-server.ts) and hands back a parser per
// language. web-tree-sitter itself is externalized from the SSR bundle (see
// vite.config.ts `ssr.external`) so its emscripten glue loads intact from
// node_modules and its own runtime wasm resolves normally; we only need to
// locate the grammar wasm ourselves.
//
// Validated in a spike: web-tree-sitter@0.26 loads @vscode/tree-sitter-wasm@0.3
// grammars and parses modern TS (satisfies/generics/optional-chaining), tsx,
// and js with no errors. See recall-phase4a-code-graph.md risk #1.

import * as fs from "node:fs";
import * as path from "node:path";
import { Parser, Language } from "web-tree-sitter";
import type { GraphLanguage } from "~/shared/code-graph";

/** Grammar wasm filename per language (@vscode/tree-sitter-wasm layout). */
const GRAMMAR_FILE: Record<GraphLanguage, string> = {
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  js: "tree-sitter-javascript.wasm",
  jsx: "tree-sitter-javascript.wasm", // the JS grammar handles JSX
};

/** Candidate dirs holding the grammar wasm, in resolution priority order. */
function graphWasmCandidates(): string[] {
  const candidates: string[] = [];
  const explicit = process.env.MC_GRAPH_WASM_DIR?.trim();
  if (explicit) candidates.push(path.resolve(explicit));
  const serverEntry = process.env.SERVER_ENTRY?.trim();
  if (serverEntry) {
    // Packaged/prod: copied next to the server bundle by copy-bundled-skills.mjs.
    candidates.push(path.resolve(path.dirname(serverEntry), "..", "bundled-wasm"));
  }
  // Dev: straight from node_modules; and the two build output layouts.
  candidates.push(path.resolve(process.cwd(), "node_modules", "@vscode", "tree-sitter-wasm", "wasm"));
  candidates.push(path.resolve(process.cwd(), "dist", "bundled-wasm"));
  candidates.push(path.resolve(process.cwd(), "dist-server", "bundled-wasm"));
  return candidates;
}

let cachedWasmDir: string | null = null;

/** The directory that actually holds the grammar wasm, or throw if none does. */
export function resolveGraphWasmDir(): string {
  if (cachedWasmDir) return cachedWasmDir;
  for (const dir of graphWasmCandidates()) {
    if (fs.existsSync(path.join(dir, GRAMMAR_FILE.ts))) {
      cachedWasmDir = dir;
      return dir;
    }
  }
  throw new Error(
    "code-graph: tree-sitter grammar wasm not found (looked in: " +
      graphWasmCandidates().join(", ") +
      ")",
  );
}

let initPromise: Promise<void> | null = null;

/** Initialize the web-tree-sitter runtime exactly once (idempotent). */
async function ensureParserInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const wasmDir = resolveGraphWasmDir();
    // In a packaged build the runtime wasm is copied beside the grammars; point
    // emscripten at it. In dev the @vscode dir has no `web-tree-sitter.wasm`, so
    // we let web-tree-sitter fall back to the copy inside its own node_modules.
    const runtimeWasm = path.join(wasmDir, "web-tree-sitter.wasm");
    if (fs.existsSync(runtimeWasm)) {
      await Parser.init({ locateFile: () => runtimeWasm });
    } else {
      await Parser.init();
    }
  })().catch((err) => {
    // Never cache a failed init — let the next build retry cleanly.
    initPromise = null;
    throw err;
  });
  return initPromise;
}

const languageCache = new Map<GraphLanguage, Language>();

async function loadLanguage(language: GraphLanguage): Promise<Language> {
  const cached = languageCache.get(language);
  if (cached) return cached;
  const wasmDir = resolveGraphWasmDir();
  const lang = await Language.load(path.join(wasmDir, GRAMMAR_FILE[language]));
  languageCache.set(language, lang);
  return lang;
}

/**
 * A parser configured for the given language. Parsers are cheap to create and
 * NOT reused across calls (a single Parser instance is not re-entrant), but the
 * loaded Language objects are cached. Call `ensureGraphParserReady()` once up
 * front to surface wasm/packaging errors before a build starts.
 */
export async function getGraphParser(language: GraphLanguage): Promise<Parser> {
  await ensureParserInit();
  const lang = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

/** Warm the runtime + all grammars; throws if the wasm can't be loaded. */
export async function ensureGraphParserReady(): Promise<void> {
  await ensureParserInit();
  await Promise.all(
    (["ts", "tsx", "js"] as GraphLanguage[]).map((l) => loadLanguage(l)),
  );
}
