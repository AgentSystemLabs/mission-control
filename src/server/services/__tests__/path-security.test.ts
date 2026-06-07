import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-path-security-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings } = await import("~/db/schema");
const { createProject } = await import("../projects");
const { resolveRegisteredProjectPath } = await import("../path-security");
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
});
