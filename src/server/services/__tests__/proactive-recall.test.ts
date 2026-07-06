import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proactive-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

// Control the code-graph side so tests don't build a real graph; memories come
// from the real DB via the project-memory service.
const getGraphStatus = vi.fn();
const searchGraphFuzzy = vi.fn();
vi.mock("../code-graph", () => ({
  getGraphStatus: (...a: unknown[]) => getGraphStatus(...a),
  searchGraphFuzzy: (...a: unknown[]) => searchGraphFuzzy(...a),
}));

const { createProject } = await import("../projects");
const { createMemory } = await import("../project-memory");
const { writeRecallSettings } = await import("../recall-settings");
const { assembleTurnContext, pickSymbolQuery, pickSymbolQueries, symbolVariants } = await import(
  "../proactive-recall"
);
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
    searchGraphFuzzy.mockReturnValue([]);
    writeRecallSettings({ enabled: true, codeGraphEnabled: true });
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
    searchGraphFuzzy.mockReturnValue([
      { name: "getDb", kind: "function", filePath: "src/db/client.ts" },
    ]);

    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toContain("Related code");
    expect(out).toContain("getDb (function) — src/db/client.ts");
    // The block re-arms the "use the graph tools, not grep" nudge every turn.
    expect(out).toContain("prefer these over grep");
    expect(searchGraphFuzzy).toHaveBeenCalledWith(project.id, "getDb", expect.any(Number));
  });

  it("omits the code section when the code graph setting is off", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: true });
    searchGraphFuzzy.mockReturnValue([{ name: "getDb", kind: "function", filePath: "src/db/client.ts" }]);
    writeRecallSettings({ codeGraphEnabled: false });

    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toBe("");
    expect(searchGraphFuzzy).not.toHaveBeenCalled();
  });

  it("omits the code section when the graph is not indexed", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: false });
    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toBe("");
    expect(searchGraphFuzzy).not.toHaveBeenCalled();
  });

  it("keeps the code section even when abundant memory would fill the budget", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: true });
    searchGraphFuzzy.mockReturnValue([
      { name: "getDb", kind: "function", filePath: "src/db/client.ts" },
    ]);
    // Five long memories that on their own overflow the default budget — the
    // code section is appended after them and used to get trimmed away entirely.
    for (let i = 0; i < 5; i++) {
      createMemory({
        projectId: project.id,
        scopeId: "local",
        type: "discovery",
        title: `getDb usage detail ${i}`,
        body: "x".repeat(200),
      });
    }
    const out = assembleTurnContext(project.id, "local", "what calls getDb?");
    expect(out).toContain("Related code");
    expect(out).toContain("getDb (function) — src/db/client.ts");
    expect(out).toContain("Relevant project memory"); // memory still present, just trimmed
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

  it("keeps most of the budget when one giant unbroken token would eat it", () => {
    const project = makeProject();
    createMemory({
      projectId: project.id,
      type: "discovery",
      title: "token finding",
      body: `x${"y".repeat(600)}`, // one 600-char unbroken token
    });
    const out = assembleTurnContext(project.id, "local", "token", { budget: 200 });
    expect(out.length).toBeLessThanOrEqual(201);
    // The word-boundary trim would have cut back to ~40 chars; the hard-slice
    // fallback keeps the block near the budget instead.
    expect(out.length).toBeGreaterThanOrEqual(120);
  });

  it("surfaces in-scope memories even when out-of-scope ones dominate the text ranking", () => {
    const project = makeProject();
    // Six strong matches in a foreign scope would previously fill the top-5
    // before the post-hoc scope filter wiped them all out.
    for (let i = 0; i < 6; i++) {
      createMemory({
        projectId: project.id,
        scopeId: "sandbox-other",
        type: "discovery",
        title: `webhook retry logic detail ${i}`,
        body: "webhook retry webhook retry webhook retry",
      });
    }
    createMemory({
      projectId: project.id,
      scopeId: "local",
      type: "discovery",
      title: "webhook retries live in queue.ts",
    });

    const out = assembleTurnContext(project.id, "local", "how do webhook retries work?");
    expect(out).toContain("webhook retries live in queue.ts");
    expect(out).not.toContain("detail 0");
  });

  it("probes fallback symbol tokens when the best one has no graph hits", () => {
    const project = makeProject();
    getGraphStatus.mockReturnValue({ indexed: true });
    // Longest identifier misses; the second candidate hits.
    searchGraphFuzzy.mockImplementation((_pid: unknown, query: unknown) =>
      query === "getDb"
        ? [{ name: "getDb", kind: "function", filePath: "src/db/client.ts" }]
        : [],
    );

    const out = assembleTurnContext(
      project.id,
      "local",
      "does SomethingNonexistent wrap getDb?",
    );
    expect(out).toContain("getDb (function) — src/db/client.ts");
    expect(searchGraphFuzzy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("pickSymbolQueries", () => {
  it("returns ranked, deduped candidates, longest first", () => {
    expect(pickSymbolQueries("does recallSettings use getDb or getDb again")).toEqual([
      "recallSettings",
      "getDb",
    ]);
  });

  it("caps the candidate count", () => {
    expect(pickSymbolQueries("AlphaOne BetaTwoLong GammaThree DeltaFour", 3)).toHaveLength(3);
  });
});

describe("symbolVariants", () => {
  it("stems agent-noun and plural words down to a searchable stem", () => {
    // The screenshot case: "toaster" must yield "toast" so it reaches `mcToast*`.
    expect(symbolVariants("toaster")).toContain("toast");
    expect(symbolVariants("toasts")).toContain("toast");
  });

  it("splits camelCase/snake identifiers into sub-words, original first", () => {
    const v = symbolVariants("ToastProvider");
    expect(v[0]).toBe("ToastProvider");
    expect(v).toContain("Toast");
    expect(v).toContain("Provider");
  });

  it("leaves short/plain tokens untouched", () => {
    expect(symbolVariants("getDb")).toEqual(["getDb", "get"]);
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
