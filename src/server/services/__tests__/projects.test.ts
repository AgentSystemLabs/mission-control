import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { listProjects, createProject, togglePin, deleteProject, updateProject, ProjectCapExceededError } = await import(
  "../projects"
);
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings } = await import("~/db/schema");
const { setLicenseKey, setLicenseValidationResult, clearLicense } = await import(
  "~/db/settings"
);
const { FREE_PROJECT_CAP } = await import("~/shared/license");

describe("projects service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
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

  describe("free-tier project cap", () => {
    const mkdir = (label: string) =>
      fs.mkdtempSync(path.join(os.tmpdir(), `mc-cap-${label}-`));

    it(`rejects creating a project beyond the cap of ${FREE_PROJECT_CAP} when no license is set`, () => {
      clearLicense();
      for (let i = 0; i < FREE_PROJECT_CAP; i++) {
        createProject({ path: mkdir(`free-${i}`) });
      }
      expect(() => createProject({ path: mkdir("over") })).toThrow(
        ProjectCapExceededError,
      );
    });

    it("allows unlimited projects when an active license is on file", () => {
      setLicenseKey("mc_live_TEST");
      setLicenseValidationResult("active", "pro");
      for (let i = 0; i < FREE_PROJECT_CAP + 2; i++) {
        const p = createProject({ path: mkdir(`pro-${i}`) });
        expect(p.id).toBeTruthy();
      }
      expect(listProjects()).toHaveLength(FREE_PROJECT_CAP + 2);
    });

    it("blocks Pro creation when grace window has expired", () => {
      setLicenseKey("mc_live_TEST");
      // active validation, then rewind grace
      setLicenseValidationResult("active", "pro");
      const db = getDb();
      // Force grace into the past:
      db.insert(appSettings)
        .values({ key: "license_offline_grace_until", value: "2020-01-01T00:00:00.000Z" })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: "2020-01-01T00:00:00.000Z" },
        })
        .run();
      for (let i = 0; i < FREE_PROJECT_CAP; i++) {
        createProject({ path: mkdir(`grace-${i}`) });
      }
      expect(() => createProject({ path: mkdir("over") })).toThrow(
        ProjectCapExceededError,
      );
    });

    it("blocks creation when license has been revoked", () => {
      setLicenseKey("mc_live_TEST");
      setLicenseValidationResult("revoked", null);
      for (let i = 0; i < FREE_PROJECT_CAP; i++) {
        createProject({ path: mkdir(`revoked-${i}`) });
      }
      expect(() => createProject({ path: mkdir("over") })).toThrow(
        ProjectCapExceededError,
      );
    });

    it("ProjectCapExceededError carries the limit and current count", () => {
      clearLicense();
      for (let i = 0; i < FREE_PROJECT_CAP; i++) {
        createProject({ path: mkdir(`err-${i}`) });
      }
      try {
        createProject({ path: mkdir("over") });
        expect.fail("expected ProjectCapExceededError");
      } catch (e) {
        expect(e).toBeInstanceOf(ProjectCapExceededError);
        expect((e as InstanceType<typeof ProjectCapExceededError>).limit).toBe(
          FREE_PROJECT_CAP,
        );
        expect((e as InstanceType<typeof ProjectCapExceededError>).current).toBe(
          FREE_PROJECT_CAP,
        );
      }
    });
  });
});
