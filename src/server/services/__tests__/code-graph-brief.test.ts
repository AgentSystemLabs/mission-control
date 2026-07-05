import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-brief-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { startGraphIndex, isGraphIndexRunning } = await import("../code-graph-indexer");
const { assembleSessionBrief, createMemory } = await import("../project-memory");
const { writeRecallSettings } = await import("../recall-settings");
const { LOCAL_SCOPE_ID } = await import("~/shared/sandbox");

function writeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-brief-fx-"));
  fs.writeFileSync(path.join(dir, "core.ts"), `export function core(): number { return 1; }\n`);
  fs.writeFileSync(
    path.join(dir, "index.ts"),
    `import { core } from "./core";\nexport function main(): number { return core() + core(); }\n`,
  );
  return dir;
}

async function runIndex(projectId: string): Promise<void> {
  startGraphIndex(projectId, "full");
  const deadline = Date.now() + 20_000;
  while (isGraphIndexRunning(projectId)) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("code graph → Session Brief", () => {
  let projectId = "";

  beforeAll(async () => {
    projectId = createProject({ name: "brief-graph", path: writeFixture() }).id;
    await runIndex(projectId);
  });

  it("leads the brief with 'Architecture at a glance' when indexed and enabled", () => {
    writeRecallSettings({ codeGraphEnabled: true });
    const { markdown } = assembleSessionBrief(projectId, LOCAL_SCOPE_ID);
    expect(markdown).toContain("Architecture at a glance");
    expect(markdown).toContain("core");
    // The tools nudge doubles as the adoption prompt.
    expect(markdown).toContain("graph_search");
  });

  it("still yields an orientation brief with a graph but no memories", () => {
    writeRecallSettings({ codeGraphEnabled: true });
    const { markdown, memoryIds } = assembleSessionBrief(projectId, LOCAL_SCOPE_ID);
    expect(markdown).toContain("Architecture at a glance");
    expect(memoryIds).toHaveLength(0);
  });

  it("omits the architecture section when the setting is off", () => {
    writeRecallSettings({ codeGraphEnabled: false });
    const { markdown } = assembleSessionBrief(projectId, LOCAL_SCOPE_ID);
    expect(markdown).not.toContain("Architecture at a glance");
    writeRecallSettings({ codeGraphEnabled: true });
  });

  it("prepends the architecture section above the memory section", () => {
    createMemory({ projectId, type: "stack", title: "TypeScript + tree-sitter" });
    const { markdown } = assembleSessionBrief(projectId, LOCAL_SCOPE_ID);
    const archIdx = markdown.indexOf("Architecture at a glance");
    const memIdx = markdown.indexOf("Project memory (Mission Control Recall)");
    expect(archIdx).toBeGreaterThanOrEqual(0);
    expect(memIdx).toBeGreaterThan(archIdx);
  });
});
