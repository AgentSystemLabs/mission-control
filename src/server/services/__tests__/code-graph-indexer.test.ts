import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { startGraphIndex, isGraphIndexRunning } = await import("../code-graph-indexer");
const { getGraphStatus, getGraphSummary, searchGraph, getNeighbors, getImpact, getShortestPath } =
  await import("../code-graph");
const { readGraphIndexState, writeGraphIndexState, readGraphFileStats } = await import(
  "../../repositories/code-graph.repo"
);
const { GRAPH_INDEX_SCHEMA_VERSION } = await import("~/shared/code-graph");

function writeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-fixture-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "." } }));
  fs.writeFileSync(path.join(dir, "core.ts"), `export function core(): number { return 1; }\n`);
  fs.writeFileSync(
    path.join(dir, "a.ts"),
    `import { core } from "./core";\nexport function a(): number { return core(); }\n`,
  );
  fs.writeFileSync(
    path.join(dir, "b.ts"),
    `import { a } from "./a";\nimport * as fs from "node:fs";\nexport function b(): number { return a() + a() + fs.constants.O_RDONLY; }\n`,
  );
  return dir;
}

async function runIndex(projectId: string, mode: "full" | "incremental" = "full"): Promise<void> {
  startGraphIndex(projectId, mode);
  const deadline = Date.now() + 30_000;
  while (isGraphIndexRunning(projectId)) {
    if (Date.now() > deadline) throw new Error("index build timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("code-graph indexer", () => {
  let projectId: string;

  beforeAll(async () => {
    const dir = writeFixture();
    const project = createProject({ name: "graph-fixture", path: dir });
    projectId = project.id;
    await runIndex(projectId);
  });

  it("produces an indexed graph with nodes and edges", () => {
    const status = getGraphStatus(projectId);
    expect(status.indexed).toBe(true);
    expect(status.fileCount).toBe(3);
    // 3 files + 3 functions
    expect(status.nodeCount).toBeGreaterThanOrEqual(6);
    expect(status.edgeCount).toBeGreaterThan(0);
    expect(status.indexing).toBeNull();
  });

  it("tags confidence honestly: extracted defines/imports, inferred calls, ambiguous externals", () => {
    const { confidenceBreakdown } = getGraphStatus(projectId);
    expect(confidenceBreakdown.extracted).toBeGreaterThan(0); // defines + resolved relative imports
    expect(confidenceBreakdown.inferred).toBeGreaterThan(0); // unique-name call resolution
    expect(confidenceBreakdown.ambiguous).toBeGreaterThan(0); // node:fs external import
  });

  it("ranks god-nodes by degree", () => {
    const summary = getGraphSummary(projectId);
    expect(summary.godNodes.length).toBeGreaterThan(0);
    // `core` and `a` are the most-connected symbols in the fixture.
    const names = summary.godNodes.map((n) => n.name);
    expect(names).toContain("core");
  });

  it("search finds nodes by name", () => {
    const nodes = searchGraph(projectId, "core", 10);
    expect(nodes.some((n) => n.name === "core" && n.kind === "function")).toBe(true);
  });

  it("resolves neighbors with import + call edges", () => {
    const result = getNeighbors(projectId, "b.ts", "out");
    expect(result).not.toBeNull();
    const kinds = new Set(result!.neighbors.map((n) => n.edge.kind));
    expect(kinds.has("imports")).toBe(true);
    expect(kinds.has("defines")).toBe(true);
    // The resolved relative import points at a real file node.
    const resolvedImport = result!.neighbors.find(
      (n) => n.edge.kind === "imports" && n.edge.confidence === "extracted",
    );
    expect(resolvedImport?.node?.filePath).toBe("a.ts");
  });

  it("computes transitive impact (reverse dependents)", () => {
    const impact = getImpact(projectId, "core");
    expect(impact).not.toBeNull();
    const names = new Set(impact!.dependents.map((n) => n.name));
    // `a` calls core directly; `a.ts` imports core.
    expect(names.has("a")).toBe(true);
  });

  it("finds a directed path between connected symbols", () => {
    const p = getShortestPath(projectId, "b.ts", "a.ts");
    expect(p?.found).toBe(true);
    expect(p!.nodes.length).toBeGreaterThanOrEqual(2);
  });
});

// The decay regression suite: incremental re-index must PRESERVE inbound edges
// from unchanged files (the original implementation deleted them, so the graph
// rotted a little on every watcher fire). Tests run in order and mutate one
// shared fixture, mirroring how the watcher drives the indexer in production.
describe("code-graph incremental re-index", () => {
  let projectId: string;
  let dir: string;

  const write = (rel: string, content: string) => fs.writeFileSync(path.join(dir, rel), content);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-incr-"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: "." } }),
    );
    write("core.ts", `export function core(): number { return 1; }\n`);
    write("a.ts", `import { core } from "./core";\nexport function a(): number { return core(); }\n`);
    write(
      "store.ts",
      `export class Store {\n  set(key: string): void { void key; }\n}\n`,
    );
    write(
      "user.ts",
      `import { Store } from "./store";\nexport function use(s: Store): void { s.set("x"); }\n`,
    );
    const project = createProject({ name: "graph-incr-fixture", path: dir });
    projectId = project.id;
    await runIndex(projectId, "full");
  });

  it("keeps inbound edges from unchanged files across incremental cycles", async () => {
    const baseline = getGraphStatus(projectId).edgeCount;
    expect(baseline).toBeGreaterThan(0);

    write("core.ts", `export function core(): number { return 2; }\n`);
    await runIndex(projectId, "incremental");
    // Second cycle with nothing changed — edge count must be stable, not decay.
    await runIndex(projectId, "incremental");

    expect(getGraphStatus(projectId).edgeCount).toBe(baseline);
    // a.ts (unchanged) still imports the re-created core.ts file node…
    const fileIn = getNeighbors(projectId, "core.ts", "in");
    expect(
      fileIn!.neighbors.some(
        (n) => n.edge.kind === "imports" && n.node?.filePath === "a.ts" && n.edge.confidence === "extracted",
      ),
    ).toBe(true);
    // …and a() (unchanged) still calls the re-created core() symbol.
    const symIn = getNeighbors(projectId, "core", "in");
    expect(
      symIn!.neighbors.some((n) => n.edge.kind === "calls" && n.node?.name === "a"),
    ).toBe(true);
  });

  it("heals a previously-unresolved call when its target symbol appears", async () => {
    write(
      "a.ts",
      `import { core } from "./core";\nexport function a(): number { return core() + newFn(); }\n`,
    );
    await runIndex(projectId, "incremental");
    // newFn doesn't exist yet: the call edge is dangling/ambiguous.
    const before = getNeighbors(projectId, "a", "out");
    const danglingCall = before!.neighbors.find(
      (n) => n.edge.kind === "calls" && n.edge.dstName === "newFn",
    );
    expect(danglingCall?.edge.dstId).toBeNull();
    expect(danglingCall?.edge.confidence).toBe("ambiguous");

    write(
      "core.ts",
      `export function core(): number { return 2; }\nexport function newFn(): number { return 3; }\n`,
    );
    await runIndex(projectId, "incremental");
    // a.ts was NOT re-parsed, yet its call edge re-attached to the new symbol.
    const after = getNeighbors(projectId, "newFn", "in");
    expect(
      after!.neighbors.some(
        (n) => n.edge.kind === "calls" && n.node?.name === "a" && n.edge.confidence === "inferred",
      ),
    ).toBe(true);
  });

  it("never cross-file resolves member calls, even through re-resolution", async () => {
    // Touch store.ts so `set` is re-inserted and the dangling `s.set()` edge
    // from user.ts (unchanged) goes through the re-resolution pass.
    write(
      "store.ts",
      `export class Store {\n  set(key: string): void { void key; }\n  has(key: string): boolean { return !!key; }\n}\n`,
    );
    await runIndex(projectId, "incremental");
    const out = getNeighbors(projectId, "use", "out");
    const memberCall = out!.neighbors.find(
      (n) => n.edge.kind === "calls" && n.edge.dstName === "set",
    );
    expect(memberCall).toBeDefined();
    expect(memberCall!.edge.dstId).toBeNull();
    expect(memberCall!.edge.confidence).toBe("ambiguous");
  });

  it("keeps a deleted file's inbound edges as dangling by-name references", async () => {
    fs.rmSync(path.join(dir, "core.ts"));
    await runIndex(projectId, "incremental");
    const out = getNeighbors(projectId, "a.ts", "out");
    const importEdge = out!.neighbors.find(
      (n) => n.edge.kind === "imports" && n.edge.dstName === "./core",
    );
    expect(importEdge).toBeDefined();
    expect(importEdge!.edge.dstId).toBeNull();
    expect(importEdge!.edge.confidence).toBe("ambiguous");
  });

  it("re-attaches dangling edges when the deleted file returns", async () => {
    write(
      "core.ts",
      `export function core(): number { return 2; }\nexport function newFn(): number { return 3; }\n`,
    );
    await runIndex(projectId, "incremental");
    const out = getNeighbors(projectId, "a.ts", "out");
    const importEdge = out!.neighbors.find(
      (n) => n.edge.kind === "imports" && n.edge.dstName === "./core",
    );
    expect(importEdge?.node?.filePath).toBe("core.ts");
    expect(importEdge?.edge.confidence).toBe("extracted");
  });

  it("guarantees inbound neighbors a share of a small limit (no out-edge starvation)", async () => {
    // hub.ts has many out-edges (6 imports + defines); caller.ts is its only
    // importer. With the old fill-out-first logic, limit 4 returned zero
    // inbound neighbors.
    for (let i = 1; i <= 6; i++) {
      write(`c${i}.ts`, `export function c${i}(): number { return ${i}; }\n`);
    }
    write(
      "hub.ts",
      Array.from({ length: 6 }, (_, i) => `import { c${i + 1} } from "./c${i + 1}";`).join("\n") +
        `\nexport function hub(): number { return c1(); }\n`,
    );
    write("caller.ts", `import { hub } from "./hub";\nexport function callHub(): number { return hub(); }\n`);
    write("server.ts", `export function serve(): void {}\n`);
    await runIndex(projectId, "incremental");

    const res = getNeighbors(projectId, "hub.ts", "both", 4);
    expect(res!.neighbors).toHaveLength(4);
    expect(res!.neighbors.some((n) => n.direction === "in")).toBe(true);
  });

  it("surfaces low-degree entry-point files in the summary", () => {
    const summary = getGraphSummary(projectId);
    expect(summary.entryPoints.some((n) => n.filePath === "server.ts")).toBe(true);
  });

  it("forces a full rebuild when the persisted state predates the schema version", async () => {
    const state = readGraphIndexState(projectId);
    writeGraphIndexState(projectId, { ...state, schemaVersion: 0 });
    await runIndex(projectId, "incremental");
    const after = readGraphIndexState(projectId);
    expect(after.lastMode).toBe("full");
    expect(after.schemaVersion).toBe(GRAPH_INDEX_SCHEMA_VERSION);
  });

  it("tracks one graph_files row per indexed file", () => {
    const stats = readGraphFileStats(projectId);
    expect(stats.size).toBe(getGraphStatus(projectId).fileCount);
    expect(stats.get("a.ts")?.hash).toBeTruthy();
  });

  it("re-parses nothing on a touch (mtime moves, content doesn't)", async () => {
    fs.utimesSync(path.join(dir, "a.ts"), new Date(), new Date());
    await runIndex(projectId, "incremental");
    expect(readGraphIndexState(projectId).lastParsedCount).toBe(0);
  });

  it("re-parses exactly the file whose content changed", async () => {
    write(
      "a.ts",
      `import { core } from "./core";\nexport function a(): number { return core() * 2 + newFn(); }\n`,
    );
    await runIndex(projectId, "incremental");
    expect(readGraphIndexState(projectId).lastParsedCount).toBe(1);
  });

  it("drops a removed file's graph_files row", async () => {
    fs.rmSync(path.join(dir, "c6.ts"));
    await runIndex(projectId, "incremental");
    expect(readGraphFileStats(projectId).has("c6.ts")).toBe(false);
  });
});

// Coverage beyond .ts/.tsx/.js/.jsx: the ESM/CJS variants (shared grammars)
// and Python (own grammar + dotted-module import resolution).
describe("code-graph multi-language coverage", () => {
  let pid: string;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-lang-fixture-"));
    fs.writeFileSync(path.join(dir, "util.mjs"), `export function util() { return 1; }\n`);
    fs.writeFileSync(
      path.join(dir, "main.ts"),
      `import { util } from "./util.mjs";\nexport function main(): number { return util(); }\n`,
    );
    fs.mkdirSync(path.join(dir, "pkg"));
    fs.writeFileSync(path.join(dir, "pkg", "__init__.py"), "");
    fs.writeFileSync(path.join(dir, "pkg", "core.py"), `def core_fn(x):\n    return x + 1\n`);
    fs.writeFileSync(
      path.join(dir, "pkg", "app.py"),
      `from .core import core_fn\n\ndef run(n):\n    return core_fn(n)\n`,
    );
    fs.writeFileSync(
      path.join(dir, "cli.py"),
      `from pkg.core import core_fn\n\ndef main_py():\n    return core_fn(2)\n`,
    );
    pid = createProject({ name: "graph-lang-fixture", path: dir }).id;
    await runIndex(pid);
  }, 30_000);

  it("indexes .mjs files and resolves a ts → mjs import", () => {
    const nodes = searchGraph(pid, "util", 10);
    expect(nodes.some((n) => n.name === "util" && n.kind === "function" && n.language === "js")).toBe(
      true,
    );
    const out = getNeighbors(pid, "main.ts", "out");
    expect(
      out?.neighbors.some(
        (nb) =>
          nb.edge.kind === "imports" &&
          nb.edge.confidence === "extracted" &&
          nb.node?.filePath === "util.mjs",
      ),
    ).toBe(true);
  });

  it("indexes python symbols with public defs marked exported", () => {
    const nodes = searchGraph(pid, "core_fn", 10);
    expect(
      nodes.some((n) => n.name === "core_fn" && n.language === "py" && n.exported),
    ).toBe(true);
  });

  it("resolves relative (.core) and absolute (pkg.core) python imports", () => {
    const app = getNeighbors(pid, "pkg/app.py", "out");
    expect(
      app?.neighbors.some((nb) => nb.edge.kind === "imports" && nb.node?.filePath === "pkg/core.py"),
    ).toBe(true);
    const cli = getNeighbors(pid, "cli.py", "out");
    expect(
      cli?.neighbors.some((nb) => nb.edge.kind === "imports" && nb.node?.filePath === "pkg/core.py"),
    ).toBe(true);
  });

  it("resolves python cross-file calls and computes impact", () => {
    const impact = getImpact(pid, "core_fn");
    expect(impact).not.toBeNull();
    const names = new Set(impact!.dependents.map((n) => n.name));
    expect(names.has("run")).toBe(true);
  });
});
