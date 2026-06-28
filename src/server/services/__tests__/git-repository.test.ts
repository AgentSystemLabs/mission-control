import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-git-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { getGitStatus, listGitBranches } = await import("../git");
const { getDb } = await import("~/db/client");
const { appSettings, groups, projects, tasks, worktrees } = await import("~/db/schema");

let tempDirs: string[] = [];

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
