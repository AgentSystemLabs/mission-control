import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MEMORY_STALE_AFTER_MS } from "~/shared/project-memory";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject, deleteProject } = await import("../projects");
const {
  createMemory,
  updateMemory,
  deleteMemory,
  supersedeMemory,
  listMemory,
  searchMemory,
  getMemory,
  assembleSessionBrief,
  markMemoriesUsed,
} = await import("../project-memory");
const { getDb } = await import("~/db/client");
const { projectMemory, projects, groups, tasks, worktrees } = await import("~/db/schema");
const { buildFtsMatch, __setMemoryFtsAvailableForTest } = await import(
  "../../repositories/project-memory.repo"
);

/** Backdate a memory well past the staleness threshold (unverified/unused). */
function makeStale(id: string) {
  const old = Date.now() - (MEMORY_STALE_AFTER_MS + 1000 * 60 * 60 * 24);
  getDb()
    .update(projectMemory)
    .set({ createdAt: old, updatedAt: old, lastUsedAt: null, lastVerifiedAt: null })
    .where(eq(projectMemory.id, id))
    .run();
}

function resetDb() {
  const db = getDb();
  db.delete(projectMemory).run();
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
}

function makeProject(name = "proj") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-proj-"));
  return createProject({ name, path: dir });
}

describe("project-memory service", () => {
  beforeEach(() => {
    resetDb();
  });

  it("creates a memory with sensible defaults and parsed tags", () => {
    const project = makeProject();
    const mem = createMemory({
      projectId: project.id,
      type: "stack",
      title: "React 19 + TanStack Router",
      body: "Vite 8, Tailwind 4, SQLite via Drizzle.",
      tags: ["frontend", "frontend", "  "],
    });
    expect(mem.type).toBe("stack");
    expect(mem.status).toBe("active");
    expect(mem.source).toBe("manual");
    expect(mem.tags).toEqual(["frontend"]); // deduped + blanks dropped
    expect(listMemory(project.id)).toHaveLength(1);
  });

  it("rejects a missing project and an empty title", () => {
    const project = makeProject();
    expect(() => createMemory({ projectId: "nope", type: "overview", title: "x" })).toThrow();
    expect(() => createMemory({ projectId: project.id, type: "overview", title: "   " })).toThrow();
  });

  it("merges a duplicate (same type + title) instead of adding a row", () => {
    const project = makeProject();
    const first = createMemory({ projectId: project.id, type: "decision", title: "Use Drizzle" });
    const second = createMemory({
      projectId: project.id,
      type: "decision",
      title: "use drizzle", // case-insensitive match
      body: "Chosen over Prisma for the embedded SQLite.",
    });
    expect(second.id).toBe(first.id); // merged
    expect(listMemory(project.id)).toHaveLength(1);
    expect(getMemory(first.id).body).toContain("Prisma");
  });

  it("searches over title, body, and tags within the project", () => {
    const project = makeProject();
    createMemory({ projectId: project.id, type: "architecture", title: "PTY spawn path" });
    createMemory({
      projectId: project.id,
      type: "known-issue",
      title: "Warm pool timing",
      body: "brief may be missed",
      tags: ["startup"],
    });
    expect(searchMemory(project.id, "spawn")).toHaveLength(1); // title
    expect(searchMemory(project.id, "missed")).toHaveLength(1); // body
    expect(searchMemory(project.id, "startup")).toHaveLength(1); // tag
    expect(searchMemory(project.id, "nothing")).toHaveLength(0);
  });

  describe("FTS5 search", () => {
    beforeEach(() => {
      __setMemoryFtsAvailableForTest(null); // re-probe (real DB has the index)
    });

    it("returns all matches, pinned first, then by bm25 relevance", () => {
      const project = makeProject();
      createMemory({
        projectId: project.id,
        type: "architecture",
        title: "Rate limiter",
        body: "rate limit strategy",
      });
      const pinned = createMemory({
        projectId: project.id,
        type: "known-issue",
        title: "Networking notes",
        body: "rate limit basics",
      });
      updateMemory(pinned.id, { pinned: true });
      const results = searchMemory(project.id, "rate limit"); // implicit AND
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe(pinned.id); // pinned floats above bm25 order
    });

    it("keeps the index in sync through update triggers", () => {
      const project = makeProject();
      const mem = createMemory({
        projectId: project.id,
        type: "discovery",
        title: "sync target",
        body: "alphaword",
      });
      expect(searchMemory(project.id, "alphaword")).toHaveLength(1);
      updateMemory(mem.id, { body: "gammaword" });
      expect(searchMemory(project.id, "alphaword")).toHaveLength(0); // old term gone
      expect(searchMemory(project.id, "gammaword")).toHaveLength(1); // new term indexed
    });

    it("falls back to LIKE substring search when FTS is unavailable", () => {
      const project = makeProject();
      createMemory({ projectId: project.id, type: "stack", title: "Auth", body: "authentication flow" });
      // Mid-token substring: LIKE matches, FTS prefix would not.
      __setMemoryFtsAvailableForTest(false);
      try {
        expect(searchMemory(project.id, "thentic")).toHaveLength(1);
      } finally {
        __setMemoryFtsAvailableForTest(null);
      }
    });

    it("builds a safe OR prefix MATCH string from free text", () => {
      expect(buildFtsMatch("Hello World")).toBe('"hello"* OR "world"*');
      expect(buildFtsMatch("auth-flow.api")).toBe('"auth"* OR "flow"* OR "api"*'); // punctuation splits
      expect(buildFtsMatch("where is the auth")).toBe('"auth"*'); // stopwords dropped
      expect(buildFtsMatch("   ")).toBe(""); // no tokens → caller uses LIKE
      expect(buildFtsMatch('drop"table')).toBe('"drop"* OR "table"*'); // quotes can't break out
    });
  });

  it("updates fields and pins", () => {
    const project = makeProject();
    const mem = createMemory({ projectId: project.id, type: "convention", title: "kebab files" });
    const updated = updateMemory(mem.id, { pinned: true, confidence: "confirmed", body: "always" });
    expect(updated.pinned).toBe(true);
    expect(updated.confidence).toBe("confirmed");
    expect(updated.body).toBe("always");
    expect(updated.lastVerifiedAt).not.toBeNull();
  });

  it("soft-deletes by default and hard-deletes on request", () => {
    const project = makeProject();
    const mem = createMemory({ projectId: project.id, type: "discovery", title: "auth in useAuth" });
    deleteMemory(mem.id);
    expect(listMemory(project.id)).toHaveLength(0); // archived hidden
    expect(listMemory(project.id, { includeArchived: true })).toHaveLength(1);

    const mem2 = createMemory({ projectId: project.id, type: "discovery", title: "gone soon" });
    deleteMemory(mem2.id, { hard: true });
    expect(listMemory(project.id, { includeArchived: true })).toHaveLength(1); // only the archived one
  });

  it("cascades away when the project is deleted", () => {
    const project = makeProject();
    createMemory({ projectId: project.id, type: "overview", title: "a mission control app" });
    expect(getDb().select().from(projectMemory).all()).toHaveLength(1);
    deleteProject(project.id);
    expect(getDb().select().from(projectMemory).all()).toHaveLength(0);
  });

  it("supersedes a memory: new head active, old archived + chained", () => {
    const project = makeProject();
    const old = createMemory({ projectId: project.id, type: "decision", title: "Use REST", body: "early" });
    const head = supersedeMemory(old.id, { title: "Use tRPC", body: "migrated for type-safety" });

    expect(head.id).not.toBe(old.id);
    expect(head.status).toBe("active");
    expect(head.lastVerifiedAt).not.toBeNull();
    // The old row is archived and points at the head.
    expect(getMemory(old.id).status).toBe("archived");
    expect(getMemory(old.id).supersededById).toBe(head.id);
    // Only the head is active, and the brief shows only the current fact.
    const active = listMemory(project.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(head.id);
    const { markdown } = assembleSessionBrief(project.id, "local");
    expect(markdown).toContain("Use tRPC");
    expect(markdown).not.toContain("Use REST");
  });

  it("sinks a stale unpinned memory below a fresh one in the brief", () => {
    const project = makeProject();
    createMemory({ projectId: project.id, type: "discovery", title: "fresh finding in the parser module" });
    const stale = createMemory({ projectId: project.id, type: "discovery", title: "stale finding in the parser module" });
    makeStale(stale.id);
    // Budget fits exactly one discovery line → the fresh one wins, stale sinks out.
    const { markdown } = assembleSessionBrief(project.id, "local", { budget: 60 });
    expect(markdown).toContain("fresh finding");
    expect(markdown).not.toContain("stale finding");
  });

  describe("session brief", () => {
    it("returns an empty brief when the project has no memories", () => {
      const project = makeProject();
      const { markdown, memoryIds } = assembleSessionBrief(project.id, "local");
      expect(markdown).toBe("");
      expect(memoryIds).toEqual([]);
    });

    it("groups selected memories by type under labelled headings", () => {
      const project = makeProject();
      createMemory({ projectId: project.id, type: "overview", title: "A CLI-agent mission control" });
      createMemory({ projectId: project.id, type: "stack", title: "Electron + SQLite" });
      createMemory({ projectId: project.id, type: "known-issue", title: "warm pool timing" });
      const { markdown, memoryIds } = assembleSessionBrief(project.id, "local");
      expect(markdown).toContain("# Project memory (Mission Control Recall)");
      expect(markdown).toContain("## Overview");
      expect(markdown).toContain("## Tech stack");
      expect(markdown).toContain("Electron + SQLite");
      expect(memoryIds.length).toBe(3);
    });

    it("always includes the core (overview/stack/pinned) but budgets the rest", () => {
      const project = makeProject();
      createMemory({ projectId: project.id, type: "overview", title: "core overview" });
      const pinned = createMemory({ projectId: project.id, type: "discovery", title: "pinned finding" });
      updateMemory(pinned.id, { pinned: true });
      // Flood with discoveries far exceeding the char budget.
      for (let i = 0; i < 80; i++) {
        createMemory({
          projectId: project.id,
          type: "discovery",
          title: `finding number ${i} with a reasonably long descriptive title`,
        });
      }
      const { markdown, memoryIds } = assembleSessionBrief(project.id, "local", { budget: 400 });
      expect(markdown).toContain("core overview"); // core always in
      expect(markdown).toContain("pinned finding"); // pinned always in
      expect(memoryIds.length).toBeLessThan(82); // budget dropped most discoveries
    });

    it("boosts memories matching the incoming task title into a tight brief", () => {
      const project = makeProject();
      createMemory({ projectId: project.id, type: "decision", title: "auth uses JWT refresh rotation" });
      for (let i = 0; i < 40; i++) {
        createMemory({ projectId: project.id, type: "discovery", title: `unrelated detail ${i} lorem ipsum dolor` });
      }
      const { markdown } = assembleSessionBrief(project.id, "local", {
        taskTitle: "fix the auth redirect bug",
        budget: 300,
      });
      expect(markdown).toContain("auth uses JWT"); // keyword-matched, survived the budget
    });

    it("markMemoriesUsed increments usage for included memories", () => {
      const project = makeProject();
      const mem = createMemory({ projectId: project.id, type: "convention", title: "kebab-case files" });
      markMemoriesUsed([mem.id]);
      expect(getMemory(mem.id).usageCount).toBe(1);
      expect(getMemory(mem.id).lastUsedAt).not.toBeNull();
    });
  });
});
