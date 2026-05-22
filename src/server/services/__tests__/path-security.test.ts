import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-path-security-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings } = await import("~/db/schema");
const { createProject } = await import("../projects");
const {
  DIRECTORY_GRANT_TTL_MS,
  grantLaunchKitParentDirectory,
  resolveLaunchKitParentDirectory,
  resolveRegisteredProjectPath,
} = await import("../path-security");
const { createProjectFromLaunchKit } = await import("../launch-kit");
const { assertSafeProjectRelativePath } = await import("../_skills-install-helpers");

function mkdir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mc-${label}-`));
}

describe("path security guards", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
    fs.rmSync(path.join(tmpRoot, "directory-grants.json"), { force: true });
  });

  it("accepts registered project roots for path-scoped writes", () => {
    const registered = mkdir("registered-project");
    const outside = mkdir("outside-project");
    createProject({ name: "registered", path: registered });

    expect(resolveRegisteredProjectPath(registered)).toBe(fs.realpathSync(registered));
    expect(() => resolveRegisteredProjectPath(outside)).toThrow(/registered Mission Control project/);
  });

  it("rejects skills install targets that cross symlinked project subdirectories", () => {
    const project = mkdir("symlinked-project");
    const outside = mkdir("outside-skills-target");
    fs.symlinkSync(outside, path.join(project, ".claude"), "dir");

    expect(() =>
      assertSafeProjectRelativePath(project, ".claude/skills/evil", "skills install"),
    ).toThrow(/symlink/);
  });

  it("requires Launch Kit parent directories to come from the folder picker grant file", () => {
    const parent = mkdir("launch-parent");

    expect(() => resolveLaunchKitParentDirectory(parent)).toThrow(/folder picker/);
    grantLaunchKitParentDirectory(parent, tmpRoot, 1_000);
    expect(resolveLaunchKitParentDirectory(parent, tmpRoot, 1_000)).toBe(
      fs.realpathSync(parent),
    );
    expect(() =>
      resolveLaunchKitParentDirectory(parent, tmpRoot, 1_000 + DIRECTORY_GRANT_TTL_MS + 1),
    ).toThrow(/folder picker/);
  });

  it("blocks Launch Kit creation before network or license work when parentDir lacks a picker grant", async () => {
    const parent = mkdir("ungranted-launch-parent");

    await expect(
      createProjectFromLaunchKit({ parentDir: parent, projectName: "new-project" }),
    ).rejects.toThrow(/folder picker/);
    expect(fs.existsSync(path.join(parent, "new-project"))).toBe(false);
  });

  it("rejects sensitive Launch Kit parent directories even when granted", () => {
    const home = os.homedir();
    grantLaunchKitParentDirectory(home, tmpRoot);

    expect(() => resolveLaunchKitParentDirectory(home, tmpRoot)).toThrow(/not allowed/);
  });

  it("rejects canonical aliases for sensitive Launch Kit parent directories", () => {
    if (!fs.existsSync("/etc")) return;
    grantLaunchKitParentDirectory("/etc", tmpRoot);

    expect(() => resolveLaunchKitParentDirectory("/etc", tmpRoot)).toThrow(/not allowed/);
  });
});
