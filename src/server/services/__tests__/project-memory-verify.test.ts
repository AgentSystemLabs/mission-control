import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-verify-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

// Stand in for the CLI-backed engine so the verdict-application logic can be
// tested without spawning a real agent. project-memory imports only
// verifyMemoryAgainstCode from the engine module.
const verifyMemoryAgainstCode = vi.fn();
vi.mock("../recall-engine", () => ({
  verifyMemoryAgainstCode: (...args: unknown[]) => verifyMemoryAgainstCode(...args),
}));

const { createProject } = await import("../projects");
const { createMemory, verifyMemory, getMemory, listMemory } = await import("../project-memory");
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

function makeProject(name = "proj") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-verify-proj-"));
  return createProject({ name, path: dir });
}

describe("verifyMemory verdict application", () => {
  beforeEach(() => {
    resetDb();
    verifyMemoryAgainstCode.mockReset();
  });

  it("verified → confirms and stamps lastVerifiedAt, running in the project cwd", async () => {
    const project = makeProject();
    const mem = createMemory({
      projectId: project.id,
      type: "stack",
      title: "Electron + SQLite",
      confidence: "inferred",
      source: "auto-distill", // starts with lastVerifiedAt = null
    });
    expect(getMemory(mem.id).lastVerifiedAt).toBeNull();
    verifyMemoryAgainstCode.mockResolvedValue({ verdict: "verified" });

    const { verdict, memory } = await verifyMemory(mem.id);
    expect(verdict).toBe("verified");
    expect(memory.confidence).toBe("confirmed");
    expect(memory.lastVerifiedAt).not.toBeNull();
    // The engine was invoked against the host project directory.
    expect(verifyMemoryAgainstCode).toHaveBeenCalledTimes(1);
    expect(verifyMemoryAgainstCode.mock.calls[0]![0]).toMatchObject({ cwd: project.path });
  });

  it("stale → downgrades confidence to ambiguous", async () => {
    const project = makeProject();
    const mem = createMemory({
      projectId: project.id,
      type: "decision",
      title: "Uses Redux",
      confidence: "inferred",
    });
    verifyMemoryAgainstCode.mockResolvedValue({ verdict: "stale" });

    const { verdict, memory } = await verifyMemory(mem.id);
    expect(verdict).toBe("stale");
    expect(memory.confidence).toBe("ambiguous");
  });

  it("contradicted → supersedes with the correction; old is archived + chained", async () => {
    const project = makeProject();
    const mem = createMemory({ projectId: project.id, type: "decision", title: "Use REST" });
    verifyMemoryAgainstCode.mockResolvedValue({
      verdict: "contradicted",
      correctedTitle: "Use tRPC",
      correctedBody: "type-safe end to end",
    });

    const { verdict, memory } = await verifyMemory(mem.id);
    expect(verdict).toBe("contradicted");
    expect(memory.id).not.toBe(mem.id);
    expect(memory.title).toBe("Use tRPC");
    // The correction is recently-learned (surfaces in the review filter).
    expect(memory.source).toBe("auto-distill");
    // The old fact is archived and chained to the correction.
    expect(getMemory(mem.id).status).toBe("archived");
    expect(getMemory(mem.id).supersededById).toBe(memory.id);
    // Only the correction remains active.
    expect(listMemory(project.id).map((m) => m.title)).toEqual(["Use tRPC"]);
  });

  it("skipped → leaves the memory untouched", async () => {
    const project = makeProject();
    const mem = createMemory({
      projectId: project.id,
      type: "stack",
      title: "React 19",
      confidence: "inferred",
      source: "auto-distill", // starts with lastVerifiedAt = null
    });
    verifyMemoryAgainstCode.mockResolvedValue({ verdict: "skipped" });

    const { verdict, memory } = await verifyMemory(mem.id);
    expect(verdict).toBe("skipped");
    expect(memory.confidence).toBe("inferred");
    expect(memory.lastVerifiedAt).toBeNull();
  });

  it("throws NotFoundError for an unknown memory", async () => {
    await expect(verifyMemory("nope")).rejects.toThrow();
  });
});
