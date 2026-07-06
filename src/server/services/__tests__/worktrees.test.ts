import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKTREE_NAME_RE } from "~/shared/worktrees";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-worktrees-test-db-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const {
  WorktreeDirtyError,
  createWorktree,
  deleteWorktree,
  generateWorktreeName,
  listWorktrees,
  resolveWorktreePath,
} = await import("../worktrees");
const { createProject, listProjects } = await import("../projects");
const { archiveTask, createTask } = await import("../tasks");
const { remove: removeWorktree } = await import("~/server/controllers/worktrees.controller");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

let tempDirs: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function createCommittedRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-worktree-repo-"));
  tempDirs.push(dir);
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Mission Control Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "initial\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

async function createProjectWorktree() {
  const root = createCommittedRepo();
  const project = createProject({ name: "worktree test", path: root });
  const { worktree } = await createWorktree(project.id);
  return { project, root, worktree };
}

describe("worktree helpers", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("generates three lowercase slug tokens", () => {
    expect(generateWorktreeName()).toMatch(WORKTREE_NAME_RE);
  });

  it("resolves worktrees under the project .worktree directory", () => {
    const root = path.resolve("/tmp/mission-control-project");
    expect(resolveWorktreePath(root, "solar-river-fox")).toBe(
      path.join(root, ".worktree", "solar-river-fox"),
    );
  });

  it("rejects invalid worktree names before path resolution", () => {
    expect(() => resolveWorktreePath("/tmp/project", "../escape-now")).toThrow(
      "invalid worktree name",
    );
  });

  it("refuses to create worktrees for projects that are not git repositories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-worktree-non-git-"));
    tempDirs.push(root);
    const project = createProject({ name: "non-git", path: root });

    await expect(createWorktree(project.id)).rejects.toThrow(/not a Git repository/);
    expect(fs.existsSync(path.join(root, ".worktree"))).toBe(false);
  });

  it("refuses to delete dirty worktrees without an explicit choice", async () => {
    const { project, worktree } = await createProjectWorktree();
    fs.writeFileSync(path.join(worktree.path, "dirty.txt"), "dirty\n");

    await expect(
      deleteWorktree({ projectId: project.id, worktreeId: worktree.id }),
    ).rejects.toBeInstanceOf(WorktreeDirtyError);
    expect(fs.existsSync(worktree.path)).toBe(true);
  });

  it("stashes dirty worktree changes before deleting when requested", async () => {
    const { project, root, worktree } = await createProjectWorktree();
    fs.writeFileSync(path.join(worktree.path, "dirty.txt"), "dirty\n");

    await expect(
      deleteWorktree({
        projectId: project.id,
        worktreeId: worktree.id,
        stashChanges: true,
      }),
    ).resolves.toBe(true);

    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(git(root, ["stash", "list"])).toContain(
      `Mission Control backup before deleting worktree ${worktree.name}`,
    );
  });

  it("force deletes dirty worktrees without creating a stash", async () => {
    const { project, root, worktree } = await createProjectWorktree();
    fs.writeFileSync(path.join(worktree.path, "dirty.txt"), "dirty\n");

    await expect(
      deleteWorktree({
        projectId: project.id,
        worktreeId: worktree.id,
        force: true,
      }),
    ).resolves.toBe(true);

    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(git(root, ["stash", "list"])).not.toContain(
      `Mission Control backup before deleting worktree ${worktree.name}`,
    );
  });

  it("deletes a clean worktree and removes its directory and row", async () => {
    const { project, worktree } = await createProjectWorktree();

    await expect(
      deleteWorktree({ projectId: project.id, worktreeId: worktree.id }),
    ).resolves.toBe(true);

    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(getDb().select().from(worktrees).all()).toHaveLength(0);
  });

  it("recovers a half-removed worktree whose git link is already gone", async () => {
    // Reproduce the Windows wedge: a prior delete failed partway (a process held
    // a handle inside the worktree), so git already removed the worktree's admin
    // dir — `git status` in the worktree now reports "is not a working tree" —
    // but leftover files (e.g. `.claude/`) and the DB row remain. The delete must
    // recover instead of throwing forever.
    const { project, root, worktree } = await createProjectWorktree();
    fs.mkdirSync(path.join(worktree.path, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(worktree.path, ".claude", "settings.json"), "{}\n");
    fs.rmSync(path.join(root, ".git", "worktrees", worktree.name), {
      recursive: true,
      force: true,
    });
    // Sanity-check we actually reproduced the wedge that used to throw.
    expect(() => git(worktree.path, ["status", "--porcelain"])).toThrow();

    await expect(
      deleteWorktree({ projectId: project.id, worktreeId: worktree.id }),
    ).resolves.toBe(true);

    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(getDb().select().from(worktrees).all()).toHaveLength(0);
  });

  it("deletes the row even when the worktree directory is already gone", async () => {
    const { project, worktree } = await createProjectWorktree();
    fs.rmSync(worktree.path, { recursive: true, force: true });

    await expect(
      deleteWorktree({ projectId: project.id, worktreeId: worktree.id }),
    ).resolves.toBe(true);
    expect(getDb().select().from(worktrees).all()).toHaveLength(0);
  });

  it("deletes legacy rows whose name and container dir predate the current scheme", async () => {
    // Older releases stored free-form names under `.worktrees/` (plural). Those
    // rows fail today's name regex and path derivation, which used to make them
    // permanently undeletable ("invalid worktree name") — especially once the
    // directory itself was already gone.
    const root = createCommittedRepo();
    const project = createProject({ name: "legacy worktree", path: root });
    const legacyPath = path.join(root, ".worktrees", "gg");
    git(root, ["worktree", "add", "-b", "gg", legacyPath, "HEAD"]);
    const now = Date.now();
    getDb()
      .insert(worktrees)
      .values({
        id: "wt-legacy-gg",
        projectId: project.id,
        name: "gg",
        path: legacyPath,
        branch: "gg",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    fs.rmSync(legacyPath, { recursive: true, force: true });

    await expect(
      deleteWorktree({ projectId: project.id, worktreeId: "wt-legacy-gg" }),
    ).resolves.toBe(true);

    expect(getDb().select().from(worktrees).all()).toHaveLength(0);
    expect(git(root, ["worktree", "list"])).not.toContain(legacyPath);
  });

  it("refuses to delete rows whose stored path escapes the worktree containers", async () => {
    const root = createCommittedRepo();
    const project = createProject({ name: "escape guard", path: root });
    const now = Date.now();
    getDb()
      .insert(worktrees)
      .values({
        id: "wt-escape",
        projectId: project.id,
        name: "solar-river-fox",
        path: root,
        branch: "solar-river-fox",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await expect(
      deleteWorktree({ projectId: project.id, worktreeId: "wt-escape" }),
    ).rejects.toThrow("worktree path is invalid");
    expect(fs.existsSync(root)).toBe(true);
  });

  it("prunes worktree rows whose directory is missing and cascades their sessions", async () => {
    const { project, worktree } = await createProjectWorktree();
    createTask({ projectId: project.id, title: "main session", agent: "claude-code", status: "finished" });
    createTask({
      projectId: project.id,
      worktreeId: worktree.id,
      title: "worktree session",
      agent: "claude-code",
      status: "finished",
    });
    fs.rmSync(worktree.path, { recursive: true, force: true });

    const listed = listWorktrees(project.id);

    expect(listed.map((w) => w.id)).toEqual(["main"]);
    expect(getDb().select().from(worktrees).all()).toHaveLength(0);
    const remaining = getDb().select().from(tasks).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.title).toBe("main session");
  });

  it("keeps worktree rows when the project root itself is missing", async () => {
    const { project, root, worktree } = await createProjectWorktree();
    fs.rmSync(root, { recursive: true, force: true });

    const listed = listWorktrees(project.id);

    expect(listed.map((w) => w.id)).toContain(worktree.id);
    expect(getDb().select().from(worktrees).all()).toHaveLength(1);
  });

  it("reports non-archived session counts per worktree", async () => {
    const { project, worktree } = await createProjectWorktree();
    createTask({ projectId: project.id, title: "main done", agent: "claude-code", status: "finished" });
    createTask({
      projectId: project.id,
      worktreeId: worktree.id,
      title: "wt running",
      agent: "claude-code",
      status: "running",
    });
    createTask({
      projectId: project.id,
      worktreeId: worktree.id,
      title: "wt done",
      agent: "claude-code",
      status: "finished",
    });
    const archived = createTask({
      projectId: project.id,
      worktreeId: worktree.id,
      title: "wt archived",
      agent: "claude-code",
      status: "finished",
    });
    archiveTask(archived.id);

    const listed = listWorktrees(project.id);
    const main = listed.find((w) => w.isMain);
    const branch = listed.find((w) => w.id === worktree.id);

    expect(main?.taskCounts?.finished).toBe(1);
    expect(main?.taskCounts?.running).toBe(0);
    expect(branch?.taskCounts?.running).toBe(1);
    expect(branch?.taskCounts?.finished).toBe(1);
  });

  it("drops sessions of pruned worktrees from project task counts", async () => {
    const { project, worktree } = await createProjectWorktree();
    createTask({ projectId: project.id, title: "main done", agent: "claude-code", status: "finished" });
    for (let i = 0; i < 3; i++) {
      createTask({
        projectId: project.id,
        worktreeId: worktree.id,
        title: `wt done ${i}`,
        agent: "claude-code",
        status: "finished",
      });
    }
    expect(listProjects()[0]!.taskCounts.finished).toBe(4);

    fs.rmSync(worktree.path, { recursive: true, force: true });

    expect(listProjects()[0]!.taskCounts.finished).toBe(1);
    expect(getDb().select().from(worktrees).all()).toHaveLength(0);
  });

  it("accepts stashChanges from the delete route query string", async () => {
    const { project, root, worktree } = await createProjectWorktree();
    fs.writeFileSync(path.join(worktree.path, "dirty.txt"), "dirty\n");

    const response = await removeWorktree(
      project.id,
      worktree.id,
      new Request(
        `http://localhost/api/projects/${project.id}/worktrees/${worktree.id}?stashChanges=true`,
        { method: "DELETE" },
      ),
    );

    expect(response.status).toBe(204);
    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(git(root, ["stash", "list"])).toContain(
      `Mission Control backup before deleting worktree ${worktree.name}`,
    );
  });
});
