import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-git-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { fetchRemote, getGitStatus, listGitBranches, pull } = await import("../git");
const { getDb } = await import("~/db/client");
const { appSettings, groups, projects, tasks, worktrees } = await import("~/db/schema");

let tempDirs: string[] = [];

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function writeCommit(cwd: string, file: string, contents: string, message: string) {
  fs.writeFileSync(path.join(cwd, file), contents);
  git(cwd, ["add", file]);
  git(cwd, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", message]);
}

describe("git repository guard", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
  });

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("reports non-git projects instead of returning an empty branch list", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-non-git-"));
    tempDirs.push(dir);
    const project = createProject({ name: "non-git", path: dir });

    await expect(listGitBranches(project.id)).rejects.toThrow(/not a Git repository/);
  });

  it("supports initialized repositories before their first commit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-empty-git-"));
    tempDirs.push(dir);
    execFileSync("git", ["init", "--initial-branch=main"], {
      cwd: dir,
      stdio: "ignore",
    });
    const project = createProject({ name: "empty-git", path: dir });

    await expect(getGitStatus(project.id)).resolves.toMatchObject({
      branch: "main",
      changedCount: 0,
    });
    await expect(listGitBranches(project.id)).resolves.toMatchObject({
      current: "main",
      branches: [],
    });
  });
});

describe("git fetch and pull", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
  });

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fetches and fast-forwards pull from a remote", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bare-"));
    const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-work-"));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "mc-local-"));
    tempDirs.push(bare, remoteWork, local);

    git(bare, ["init", "--bare", "--initial-branch=main"]);
    git(remoteWork, ["clone", bare, "."]);
    writeCommit(remoteWork, "README.md", "one\n", "initial");
    git(remoteWork, ["push", "-u", "origin", "main"]);

    git(local, ["clone", bare, "."]);
    const project = createProject({ name: "synced", path: local });

    writeCommit(remoteWork, "README.md", "two\n", "remote update");
    git(remoteWork, ["push", "origin", "main"]);

    await expect(fetchRemote(project.id)).resolves.toMatchObject({ kind: "fetched" });
    await expect(pull(project.id)).resolves.toMatchObject({ kind: "pulled" });
    expect(fs.readFileSync(path.join(local, "README.md"), "utf8")).toBe("two\n");
  });

  it("reports already-up-to-date when there is nothing to pull", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bare-up-"));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "mc-local-up-"));
    tempDirs.push(bare, local);

    git(bare, ["init", "--bare", "--initial-branch=main"]);
    const seed = fs.mkdtempSync(path.join(os.tmpdir(), "mc-seed-"));
    tempDirs.push(seed);
    git(seed, ["clone", bare, "."]);
    writeCommit(seed, "a.txt", "a\n", "seed");
    git(seed, ["push", "-u", "origin", "main"]);

    git(local, ["clone", bare, "."]);
    const project = createProject({ name: "up-to-date", path: local });

    await expect(pull(project.id)).resolves.toMatchObject({ kind: "already-up-to-date" });
  });

  it("rejects ff-only pull when the branch has diverged", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bare-div-"));
    const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-div-"));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "mc-local-div-"));
    tempDirs.push(bare, remoteWork, local);

    git(bare, ["init", "--bare", "--initial-branch=main"]);
    git(remoteWork, ["clone", bare, "."]);
    writeCommit(remoteWork, "README.md", "base\n", "base");
    git(remoteWork, ["push", "-u", "origin", "main"]);

    git(local, ["clone", bare, "."]);
    writeCommit(local, "local.txt", "local\n", "local only");
    writeCommit(remoteWork, "remote.txt", "remote\n", "remote only");
    git(remoteWork, ["push", "origin", "main"]);

    const project = createProject({ name: "diverged", path: local });
    await expect(pull(project.id)).rejects.toThrow(/diverged|rebase|merge/i);
  });

  it("pulls diverged branches with rebase", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bare-reb-"));
    const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-reb-"));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "mc-local-reb-"));
    tempDirs.push(bare, remoteWork, local);

    git(bare, ["init", "--bare", "--initial-branch=main"]);
    git(remoteWork, ["clone", bare, "."]);
    writeCommit(remoteWork, "README.md", "base\n", "base");
    git(remoteWork, ["push", "-u", "origin", "main"]);

    git(local, ["clone", bare, "."]);
    writeCommit(local, "local.txt", "local\n", "local only");
    writeCommit(remoteWork, "remote.txt", "remote\n", "remote only");
    git(remoteWork, ["push", "origin", "main"]);

    const project = createProject({ name: "rebase-pull", path: local });
    await expect(pull(project.id, null, "rebase")).resolves.toMatchObject({ kind: "pulled" });
    expect(fs.existsSync(path.join(local, "local.txt"))).toBe(true);
    expect(fs.existsSync(path.join(local, "remote.txt"))).toBe(true);
  });

  it("pulls diverged branches with merge", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bare-mer-"));
    const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-mer-"));
    const local = fs.mkdtempSync(path.join(os.tmpdir(), "mc-local-mer-"));
    tempDirs.push(bare, remoteWork, local);

    git(bare, ["init", "--bare", "--initial-branch=main"]);
    git(remoteWork, ["clone", bare, "."]);
    writeCommit(remoteWork, "README.md", "base\n", "base");
    git(remoteWork, ["push", "-u", "origin", "main"]);

    git(local, ["clone", bare, "."]);
    writeCommit(local, "local.txt", "local\n", "local only");
    writeCommit(remoteWork, "remote.txt", "remote\n", "remote only");
    git(remoteWork, ["push", "origin", "main"]);

    const project = createProject({ name: "merge-pull", path: local });
    await expect(pull(project.id, null, "merge")).resolves.toMatchObject({ kind: "pulled" });
    expect(fs.existsSync(path.join(local, "local.txt"))).toBe(true);
    expect(fs.existsSync(path.join(local, "remote.txt"))).toBe(true);
  });
});
