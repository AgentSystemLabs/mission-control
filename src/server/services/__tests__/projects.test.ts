import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;
const keypair = generateKeyPairSync("ed25519");
process.env.MC_LICENSE_PUBLIC_KEY = keypair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const {
  listProjects,
  createProject,
  togglePin,
  reorderPinnedProjects,
  deleteProject,
  updateProject,
  getProjectPathStatus,
  ProjectCapExceededError,
} = await import("../projects");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");
const { setLicenseKey, clearLicense } = await import("../license-storage");
const { FREE_PROJECT_CAP } = await import("~/shared/license");

function signedLicense(overrides: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      licenseId: "lic_test",
      customerId: "cus_test",
      product: "mission-control-pro",
      tier: "pro",
      expiresAt: null,
      maxMachines: 3,
      issuedAt: "2026-05-07T17:10:17.000Z",
      ...overrides,
    }),
    "utf8",
  );
  const signature = sign(null, payload, keypair.privateKey);
  return `MC-PRO-v1.${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

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

  it("persists pinned reorder across reads", () => {
    setLicenseKey(signedLicense());
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
      setLicenseKey(signedLicense());
      for (let i = 0; i < FREE_PROJECT_CAP + 2; i++) {
        const p = createProject({ path: mkdir(`pro-${i}`) });
        expect(p.id).toBeTruthy();
      }
      expect(listProjects()).toHaveLength(FREE_PROJECT_CAP + 2);
    });

    it("blocks Pro creation when a signed license is expired", () => {
      setLicenseKey(
        signedLicense({
          licenseId: "lic_expired",
          expiresAt: "2020-01-01T00:00:00.000Z",
          issuedAt: "2019-01-01T00:00:00.000Z",
        }),
      );
      for (let i = 0; i < FREE_PROJECT_CAP; i++) {
        createProject({ path: mkdir(`expired-${i}`) });
      }
      expect(() => createProject({ path: mkdir("over") })).toThrow(
        ProjectCapExceededError,
      );
    });

    it("blocks creation when the stored license is unsigned", () => {
      setLicenseKey("mc_live_TEST");
      for (let i = 0; i < FREE_PROJECT_CAP; i++) {
        createProject({ path: mkdir(`unsigned-${i}`) });
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
