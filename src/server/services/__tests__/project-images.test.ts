import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-img-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject, deleteProject, getProject } = await import("../projects");
const {
  setProjectImage,
  clearProjectImage,
  projectImagesDir,
  projectImageAbsolutePath,
  deleteAllProjectImagesFor,
} = await import("../project-images");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups } = await import("~/db/schema");

function workdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-img-proj-"));
}

function touchImage(projectId: string, ext = "png"): string {
  const dir = projectImagesDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${projectId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return filename;
}

describe("project-images service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
  });

  it("setProjectImage persists imagePath on the project row", async () => {
    const c = await createProject({ name: "img1", path: workdir() });
    const filename = touchImage(c.id);
    const updated = setProjectImage(c.id, filename);
    expect(updated?.imagePath).toBe(filename);
    expect((await getProject(c.id))?.imagePath).toBe(filename);
  });

  it("clearProjectImage nulls the column and removes the file", async () => {
    const c = await createProject({ name: "img2", path: workdir() });
    const filename = touchImage(c.id);
    setProjectImage(c.id, filename);
    expect(fs.existsSync(path.join(projectImagesDir(), filename))).toBe(true);

    const cleared = clearProjectImage(c.id);
    expect(cleared?.imagePath).toBeNull();
    expect(fs.existsSync(path.join(projectImagesDir(), filename))).toBe(false);
  });

  it("deleteAllProjectImagesFor sweeps every extension for a project", async () => {
    const c = await createProject({ name: "img3", path: workdir() });
    touchImage(c.id, "png");
    touchImage(c.id, "jpg");
    deleteAllProjectImagesFor(c.id);
    const remaining = fs
      .readdirSync(projectImagesDir())
      .filter((n) => n.startsWith(`${c.id}.`));
    expect(remaining).toEqual([]);
  });

  it("deleteProject removes the row even when imagePath is set", async () => {
    const c = await createProject({ name: "img4", path: workdir() });
    const filename = touchImage(c.id);
    setProjectImage(c.id, filename);
    expect(deleteProject(c.id)).toBe(true);
    expect(await getProject(c.id)).toBeNull();
  });

  it("deleteProject synchronously cleans up image files", async () => {
    const c = await createProject({ name: "img5", path: workdir() });
    touchImage(c.id, "png");
    touchImage(c.id, "jpg");
    deleteProject(c.id);
    const remaining = fs
      .readdirSync(projectImagesDir())
      .filter((n) => n.startsWith(`${c.id}.`));
    expect(remaining).toEqual([]);
  });

  it("projectImageAbsolutePath rejects path-traversal attempts", () => {
    const dir = projectImagesDir();
    const sneaky = projectImageAbsolutePath("../../etc/passwd");
    expect(sneaky.startsWith(dir)).toBe(true);
    expect(sneaky).not.toContain("..");
    const a = projectImageAbsolutePath("/absolute/path.png");
    expect(a.startsWith(dir)).toBe(true);
  });
});
