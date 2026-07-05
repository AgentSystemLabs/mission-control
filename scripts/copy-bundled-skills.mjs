#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, ".agents", "skills");
const corePluginSource = path.join(repoRoot, "..", "core", "plugins", "agentsystem-core");
const targetRoot = path.join(repoRoot, "dist", "bundled-skills");
const BUNDLED_SKILL_NAMES = ["diagram", "recall"];

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest);
      continue;
    }
    if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

if (!fs.existsSync(sourceRoot)) {
  console.error(`[copy-bundled-skills] missing source directory: ${sourceRoot}`);
  process.exit(1);
}

let copied = 0;
for (const skillName of BUNDLED_SKILL_NAMES) {
  const skillDir = path.join(sourceRoot, skillName);
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    console.warn(`[copy-bundled-skills] missing bundled skill: ${skillName}`);
    continue;
  }
  const dest = path.join(targetRoot, skillName);
  fs.rmSync(dest, { recursive: true, force: true });
  copyTree(skillDir, dest);
  copied += 1;
  console.log(`[copy-bundled-skills] copied ${skillName}`);
}

if (copied === 0) {
  console.warn("[copy-bundled-skills] no skills with SKILL.md found");
}

const coreSkillMarker = path.join(corePluginSource, "skills", "ship", "SKILL.md");
if (fs.existsSync(coreSkillMarker)) {
  const coreDest = path.join(targetRoot, "agentsystem-core");
  fs.rmSync(coreDest, { recursive: true, force: true });
  copyTree(corePluginSource, coreDest);
  console.info("[copy-bundled-skills] copied agentsystem-core plugin");
} else {
  console.warn(
    `[copy-bundled-skills] missing core plugin source: ${corePluginSource}`,
  );
}

// Recall Code Graph: bundle the tree-sitter grammar wasm (+ web-tree-sitter's
// own runtime wasm) next to the server bundle so the indexer resolves them in a
// packaged build via SERVER_ENTRY/../bundled-wasm (see code-graph-wasm.ts).
const wasmDest = path.join(repoRoot, "dist", "bundled-wasm");
const grammarSrc = path.join(
  repoRoot,
  "node_modules",
  "@vscode",
  "tree-sitter-wasm",
  "wasm",
);
const runtimeWasm = path.join(repoRoot, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm");
const wasmFiles = [
  [path.join(grammarSrc, "tree-sitter-typescript.wasm"), "tree-sitter-typescript.wasm"],
  [path.join(grammarSrc, "tree-sitter-tsx.wasm"), "tree-sitter-tsx.wasm"],
  [path.join(grammarSrc, "tree-sitter-javascript.wasm"), "tree-sitter-javascript.wasm"],
  [runtimeWasm, "web-tree-sitter.wasm"],
];
let wasmCopied = 0;
fs.mkdirSync(wasmDest, { recursive: true });
for (const [src, name] of wasmFiles) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-bundled-skills] missing code-graph wasm: ${src}`);
    continue;
  }
  fs.copyFileSync(src, path.join(wasmDest, name));
  wasmCopied += 1;
}
console.log(`[copy-bundled-skills] copied ${wasmCopied} code-graph wasm file(s)`);

// Recall code-graph MCP server: esbuild-bundle the stdio server into a single
// self-contained .mjs so a packaged build can run it via plain `node` with no
// node_modules (asar can't be require()'d by an external node). Shipped under
// resources/bundled-mcp (extraResources) and referenced by ensure-recall-mcp.ts.
const mcpEntry = path.join(repoRoot, "bundled-mcp", "recall-mcp.mjs");
const mcpOutDir = path.join(repoRoot, "dist", "bundled-mcp");
if (fs.existsSync(mcpEntry)) {
  fs.mkdirSync(mcpOutDir, { recursive: true });
  await esbuild.build({
    entryPoints: [mcpEntry],
    outfile: path.join(mcpOutDir, "recall-mcp.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // Node built-ins stay external; everything else (SDK + zod) is inlined.
    banner: { js: "// Bundled by copy-bundled-skills.mjs — do not edit." },
    logLevel: "warning",
  });
  console.log("[copy-bundled-skills] bundled recall MCP server");
} else {
  console.warn(`[copy-bundled-skills] missing MCP entry: ${mcpEntry}`);
}
