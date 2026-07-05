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

async function runIndex(projectId: string): Promise<void> {
  startGraphIndex(projectId, "full");
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
