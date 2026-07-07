import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-fuzzy-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { insertGraphNodes, searchNodesFuzzy } = await import(
  "../../repositories/code-graph.repo"
);
const { getDb } = await import("~/db/client");
const { graphNodes } = await import("~/db/schema");

let projectId = "";

function seed(rows: Array<{ name: string; filePath: string; degree: number; kind?: string }>): void {
  const now = Date.now();
  insertGraphNodes(
    rows.map((r, i) => ({
      id: `n-${i}-${r.name}`,
      projectId,
      kind: (r.kind ?? "function") as never,
      name: r.name,
      filePath: r.filePath,
      startLine: 1,
      endLine: 1,
      exported: true,
      signature: null,
      language: r.filePath.endsWith("tsx") ? ("tsx" as never) : ("ts" as never),
      degree: r.degree,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

function names(rows: { name: string }[]): string[] {
  return rows.map((r) => r.name);
}

describe("searchNodesFuzzy (proactive-recall bidirectional match)", () => {
  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-fuzzy-proj-"));
    projectId = createProject({ name: "fuzzy", path: dir }).id;
    getDb().delete(graphNodes).run();
    seed([
      { name: "Toast", filePath: "src/components/Toast.tsx", degree: 10 },
      { name: "ToastProvider", filePath: "src/components/ToastProvider.tsx", degree: 5 },
      { name: "authenticate", filePath: "src/server/auth.ts", degree: 8 },
      { name: "id", filePath: "src/lib/ids.ts", degree: 100, kind: "variable" },
    ]);
  });

  it("reverse-matches a symbol whose name is a suffix-variant of the query (toaster → Toast)", () => {
    // The exact screenshot failure: the LIKE %toaster% used before could never
    // match `Toast`; the reverse instr() direction does.
    const hits = names(searchNodesFuzzy(projectId, "toaster", 10));
    expect(hits).toContain("Toast");
    // "toaster" does not contain "toastprovider", so it must NOT drag that in.
    expect(hits).not.toContain("ToastProvider");
  });

  it("reverse-matches trivial plurals (toasts → Toast)", () => {
    expect(names(searchNodesFuzzy(projectId, "toasts", 10))).toContain("Toast");
  });

  it("forward-matches when the query is a substring of the symbol (auth → authenticate)", () => {
    expect(names(searchNodesFuzzy(projectId, "auth", 10))).toContain("authenticate");
  });

  it("returns the most-connected match first (Toast before ToastProvider for 'toast')", () => {
    const hits = names(searchNodesFuzzy(projectId, "toast", 10));
    expect(hits).toContain("Toast");
    expect(hits).toContain("ToastProvider");
    expect(hits.indexOf("Toast")).toBeLessThan(hits.indexOf("ToastProvider"));
  });

  it("does not let a short symbol name (id) reverse-match a long query", () => {
    // `id` is a substring of "identifier", but the name-length floor rejects it —
    // otherwise every 2-char symbol would flood descriptive prompts.
    expect(names(searchNodesFuzzy(projectId, "identifier", 10))).not.toContain("id");
  });

  it("skips very short queries entirely", () => {
    expect(searchNodesFuzzy(projectId, "ab", 10)).toHaveLength(0);
  });
});
