import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { listProjects, createProject, togglePin, deleteProject, updateProject } = await import(
  "../projects"
);
const { getDb } = await import("~/db/client");
const { projects, tasks, groups } = await import("~/db/schema");

describe("projects service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
  });

  it("rejects nonexistent paths", () => {
    expect(() =>
      createProject({ name: "no-go", path: "/definitely/not/here/i/promise" })
    ).toThrow();
  });

  it("creates and lists a project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-"));
    const created = createProject({ name: "alpha", path: dir });
    expect(created.id).toBeTruthy();

    const all = listProjects();
    expect(all.some((p) => p.id === created.id)).toBe(true);
  });

  it("toggles pin and updates fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-"));
    const c = createProject({ name: "beta", path: dir });
    const after = togglePin(c.id);
    expect(after?.pinned).toBe(true);
    const renamed = updateProject(c.id, { name: "beta-2" });
    expect(renamed?.name).toBe("beta-2");
  });

  it("deletes cleanly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-"));
    const c = createProject({ name: "gamma", path: dir });
    expect(deleteProject(c.id)).toBe(true);
    expect(listProjects().some((p) => p.id === c.id)).toBe(false);
  });

  it("derives name from folder basename when name is omitted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-named-"));
    const c = createProject({ path: dir });
    expect(c.name).toBe(path.basename(dir));
  });
});
