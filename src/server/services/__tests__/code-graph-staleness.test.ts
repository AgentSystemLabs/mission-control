import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-stale-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { startGraphIndex, isGraphIndexRunning } = await import("../code-graph-indexer");
const { getGraphStatus } = await import("../code-graph");
const { staleFilesAmong, __resetStaleCountCache } = await import("../code-graph-staleness");

let dir = "";
let projectId = "";

async function runIndex(mode: "full" | "incremental" = "full"): Promise<void> {
  startGraphIndex(projectId, mode);
  const deadline = Date.now() + 30_000;
  while (isGraphIndexRunning(projectId)) {
    if (Date.now() > deadline) throw new Error("index build timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-stale-fixture-"));
  fs.writeFileSync(path.join(dir, "core.ts"), `export function core(): number { return 1; }\n`);
  fs.writeFileSync(
    path.join(dir, "a.ts"),
    `import { core } from "./core";\nexport function a(): number { return core(); }\n`,
  );
  projectId = createProject({ name: "graph-stale-fixture", path: dir }).id;
  await runIndex();
});

// Content edits below change the file SIZE, so staleness is detected even on
// coarse-mtime filesystems (CI tmpfs/overlayfs floor mtime to whole seconds).
describe("code-graph staleness", () => {
  it("reports nothing stale right after an index", () => {
    expect(staleFilesAmong(projectId, ["core.ts", "a.ts"])).toEqual([]);
    __resetStaleCountCache();
    expect(getGraphStatus(projectId).staleFileCount).toBe(0);
  });

  it("flags a file whose content changed since the index", () => {
    fs.appendFileSync(path.join(dir, "core.ts"), `export const extra = 2;\n`);
    expect(staleFilesAmong(projectId, ["core.ts", "a.ts"])).toEqual(["core.ts"]);
  });

  it("counts stale files in status (cache busts on reset)", () => {
    __resetStaleCountCache();
    expect(getGraphStatus(projectId).staleFileCount).toBe(1);
  });

  it("caches the whole-graph sweep until reset or re-index", () => {
    // Second modification within the TTL window: cached count stays at 1.
    fs.appendFileSync(path.join(dir, "a.ts"), `export const more = 3;\n`);
    expect(getGraphStatus(projectId).staleFileCount).toBe(1);
    __resetStaleCountCache();
    expect(getGraphStatus(projectId).staleFileCount).toBe(2);
  });

  it("treats a deleted file as stale", async () => {
    fs.writeFileSync(path.join(dir, "gone.ts"), `export const g = 1;\n`);
    await runIndex("incremental");
    fs.rmSync(path.join(dir, "gone.ts"));
    expect(staleFilesAmong(projectId, ["gone.ts"])).toEqual(["gone.ts"]);
  });

  it("clears after a re-index without needing a cache reset (keyed on lastIndexedAt)", async () => {
    await runIndex("incremental");
    expect(staleFilesAmong(projectId, ["core.ts", "a.ts"])).toEqual([]);
    // No __resetStaleCountCache: the fresh lastIndexedAt invalidates the entry.
    expect(getGraphStatus(projectId).staleFileCount).toBe(0);
  });

  it("skips paths without an indexed baseline", () => {
    expect(staleFilesAmong(projectId, ["never-indexed.ts"])).toEqual([]);
  });
});
