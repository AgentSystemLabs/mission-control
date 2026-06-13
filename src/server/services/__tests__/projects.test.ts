import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const {
  listProjects,
  createProject,
  getProject,
  togglePin,
  reorderPinnedProjects,
  deleteProject,
  updateProject,
  getProjectPathStatus,
} = await import("../projects");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees, sandboxes } = await import("~/db/schema");

describe("projects service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
  });

  it("rejects nonexistent paths", () => {
    expect(() =>
      createProject({ name: "no-go", path: "/definitely/not/here/i/promise" })
    ).toThrow();
  });

  it("reports a missing persisted project path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-missing-"));
    const created = createProject({ name: "missing", path: dir });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(getProjectPathStatus(created.id)).toMatchObject({
      ok: false,
      reason: "missing",
      path: dir,
    });
  });

  it("reports a missing selected worktree path", () => {
    const db = getDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-worktree-root-"));
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-worktree-"));
    const created = createProject({ name: "worktree", path: dir });
    const now = Date.now();
    db.insert(worktrees)
      .values({
        id: "wt-missing",
        projectId: created.id,
        name: "missing-worktree",
        path: worktreeDir,
        branch: "feature/missing",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    fs.rmSync(worktreeDir, { recursive: true, force: true });

    expect(getProjectPathStatus(created.id, "wt-missing")).toMatchObject({
      ok: false,
      scope: "worktree",
      reason: "missing",
      path: worktreeDir,
    });
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
    expect(after?.pinnedOrder).toBe(0);
    const renamed = updateProject(c.id, { name: "beta-2" });
    expect(renamed?.name).toBe("beta-2");
  });

  it("appends newly pinned projects and clears order on unpin", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-b-"));
    const a = createProject({ name: "alpha", path: dirA });
    const b = createProject({ name: "beta", path: dirB });
    togglePin(a.id);
    togglePin(b.id);
    const unpinned = togglePin(b.id);
    expect(unpinned?.pinned).toBe(false);
    expect(unpinned?.pinnedOrder).toBeNull();
    const repinned = togglePin(b.id);
    expect(repinned?.pinned).toBe(true);
    expect(repinned?.pinnedOrder).toBe(1);
  });

  it("reorders pinned projects independently per sandbox scope", () => {
    const db = getDb();
    const sandboxId = "sb-test";
    const now = Date.now();
    db.insert(sandboxes)
      .values({
        id: sandboxId,
        name: "Test sandbox",
        kind: "remote-vm",
        color: null,
        imageTag: null,
        dockerfilePath: null,
        buildArgs: null,
        gitAuthMode: "none",
        declaredPorts: null,
        env: null,
        hostAgentPort: null,
        portMap: null,
        pairingToken: null,
        remoteConfig: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const dirLocal = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-local-"));
    const dirSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-sandbox-"));
    const local = createProject({ name: "local", path: dirLocal, sandboxId: null });
    const sandbox = createProject({ name: "sandbox", path: dirSandbox, sandboxId });
    togglePin(local.id);
    togglePin(sandbox.id);
    expect(() => reorderPinnedProjects([sandbox.id])).not.toThrow();
    expect(() => reorderPinnedProjects([local.id])).not.toThrow();
    expect(getProject(local.id)?.pinnedOrder).toBe(0);
    expect(getProject(sandbox.id)?.pinnedOrder).toBe(0);
  });

  it("persists pinned reorder across reads", () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-reorder-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-reorder-b-"));
    const a = createProject({ name: "alpha", path: dirA });
    const b = createProject({ name: "beta", path: dirB });
    togglePin(a.id);
    togglePin(b.id);
    reorderPinnedProjects([b.id, a.id]);
    expect(
      listProjects()
        .filter((project) => project.pinned)
        .sort((left, right) => (left.pinnedOrder ?? 0) - (right.pinnedOrder ?? 0))
        .map((project) => project.id),
    ).toEqual([b.id, a.id]);
  });

  it("rejects updating a project to a nonexistent path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-update-"));
    const c = createProject({ name: "beta", path: dir });

    expect(() =>
      updateProject(c.id, { path: "/definitely/not/here/i/promise" })
    ).toThrow(/Working directory does not exist/);
    expect(getProjectPathStatus(c.id)).toMatchObject({ ok: true, path: dir });
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
