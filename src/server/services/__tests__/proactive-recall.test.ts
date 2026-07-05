import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proactive-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

// Control the code-graph side so tests don't build a real graph; memories come
// from the real DB via the project-memory service.
const getGraphStatus = vi.fn();
const searchGraph = vi.fn();
vi.mock("../code-graph", () => ({
  getGraphStatus: (...a: unknown[]) => getGraphStatus(...a),
  searchGraph: (...a: unknown[]) => searchGraph(...a),
}));

const { createProject } = await import("../projects");
const { createMemory } = await import("../project-memory");
const { writeRecallSettings } = await import("../recall-settings");
const { assembleTurnContext, pickSymbolQuery } = await import("../proactive-recall");
const { getDb } = await import("~/db/client");
const { projectMemory, projects, groups, tasks, worktrees } = await import("~/db/schema");

function resetDb() {
  const db = getDb();
  db.delete(projectMemory).run();
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proactive-proj-"));
  return createProject({ name: "proj", path: dir });
}

describe("assembleTurnContext", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    getGraphStatus.mockReturnValue({ indexed: false });
    searchGraph.mockReturnValue([]);
    writeRecallSettings({ codeGraphEnabled: true });
  });

  it("renders the memories most relevant to the prompt", () => {
    const project = makeProject();
    createMemory({ projectId: project.id, type: "architecture", title: "Auth lives in useAuth hook" });
    createMemory({ projectId: project.id, type: "stack", title: "Styling uses Tailwind" });

    const out = assembleTurnContext(project.id, "local", "where does auth happen?");
    expect(out).toContain("Relevant project memory");
    expect(out).toContain("Auth lives in useAuth hook");
    expect(out).not.toContain("Tailwind");
  });

  it("returns empty when nothing is relevant", () => {
    const project = makeProject();
    createMemory({ projectId: project.id, type: "stack", title: "Styling uses Tailwind" });
    expect(assembleTurnContext(project.id, "local", "quantum chromodynamics")).toBe("");
  });

  it("adds a code section when the graph is indexed and the prompt names a symbol", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: true });
    searchGraph.mockReturnValue([
      { name: "getDb", kind: "function", filePath: "src/db/client.ts" },
    ]);

    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toContain("Related code");
    expect(out).toContain("getDb (function) — src/db/client.ts");
    expect(searchGraph).toHaveBeenCalledWith(project.id, "getDb", expect.any(Number));
  });

  it("omits the code section when the code graph setting is off", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: true });
    searchGraph.mockReturnValue([{ name: "getDb", kind: "function", filePath: "src/db/client.ts" }]);
    writeRecallSettings({ codeGraphEnabled: false });

    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toBe("");
    expect(searchGraph).not.toHaveBeenCalled();
  });

  it("omits the code section when the graph is not indexed", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: false });
    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toBe("");
    expect(searchGraph).not.toHaveBeenCalled();
  });

  it("trims to the char budget", () => {
    const project = makeProject();
    for (let i = 0; i < 5; i++) {
      createMemory({
        projectId: project.id,
        type: "discovery",
        title: `token finding number ${i}`,
        body: "x".repeat(200),
      });
    }
    const out = assembleTurnContext(project.id, "local", "token", { budget: 120 });
    expect(out.length).toBeLessThanOrEqual(121); // budget + the "…"
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("pickSymbolQuery", () => {
  it("prefers identifier-shaped tokens", () => {
    expect(pickSymbolQuery("what calls getDb here")).toBe("getDb");
    expect(pickSymbolQuery("look at recall_settings please")).toBe("recall_settings");
  });

  it("falls back to the longest plain word", () => {
    expect(pickSymbolQuery("explain the authentication flow")).toBe("authentication");
  });

  it("returns empty when nothing looks symbol-like", () => {
    expect(pickSymbolQuery("do it now")).toBe("");
  });
});
