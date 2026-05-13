import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const {
  listUserTerminals,
  createUserTerminal,
  renameUserTerminal,
  deleteUserTerminal,
  purgeLaunchSpawnedTerminals,
} = await import("../user-terminals");
const { getDb } = await import("~/db/client");
const { projects, tasks, userTerminals } = await import("~/db/schema");

async function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ut-"));
  return createProject({ name: "p", path: dir });
}

describe("user-terminals service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(userTerminals).run();
    db.delete(tasks).run();
    db.delete(projects).run();
  });

  it("creates with default name and lists in insertion order", async () => {
    const p = await makeProject();
    const a = createUserTerminal({ projectId: p.id });
    const b = createUserTerminal({ projectId: p.id });
    expect(a.name).toBe("Terminal 1");
    expect(b.name).toBe("Terminal 2");
    const list = listUserTerminals(p.id);
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("renames", async () => {
    const p = await makeProject();
    const t = createUserTerminal({ projectId: p.id });
    const renamed = renameUserTerminal(t.id, "  dev server  ");
    expect(renamed?.name).toBe("dev server");
  });

  it("rejects empty rename", async () => {
    const p = await makeProject();
    const t = createUserTerminal({ projectId: p.id });
    expect(() => renameUserTerminal(t.id, "   ")).toThrow();
  });

  it("deletes only the targeted row", async () => {
    const p = await makeProject();
    const a = createUserTerminal({ projectId: p.id });
    const b = createUserTerminal({ projectId: p.id });
    expect(deleteUserTerminal(a.id)).toBe(true);
    const remaining = listUserTerminals(p.id);
    expect(remaining.map((t) => t.id)).toEqual([b.id]);
  });

  it("scopes terminals per project", async () => {
    const p1 = await makeProject();
    const p2 = await makeProject();
    createUserTerminal({ projectId: p1.id });
    createUserTerminal({ projectId: p2.id });
    expect(listUserTerminals(p1.id)).toHaveLength(1);
    expect(listUserTerminals(p2.id)).toHaveLength(1);
  });

  it("does not persist launch-created terminals", async () => {
    const p = await makeProject();
    const terminal = createUserTerminal({
      projectId: p.id,
      name: "Dev server",
      cwd: p.path,
      startCommand: "pnpm dev",
    });

    expect(terminal.startCommand).toBe("pnpm dev");
    expect(listUserTerminals(p.id)).toHaveLength(0);
  });

  it("purgeLaunchSpawnedTerminals removes stale launch-created rows", async () => {
    const p = await makeProject();
    const db = getDb();
    db.insert(userTerminals)
      .values({
        id: "ut-stale-launch",
        projectId: p.id,
        name: "Dev server",
        cwd: p.path,
        startCommand: "pnpm dev",
        position: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    // listUserTerminals is read-only and already filters out start_command rows.
    expect(listUserTerminals(p.id)).toHaveLength(0);
    // Explicit purge (what boot now calls) is what actually deletes them.
    expect(purgeLaunchSpawnedTerminals()).toBeGreaterThanOrEqual(1);
    expect(db.select().from(userTerminals).all()).toHaveLength(0);
  });

  it("cascades on project delete", async () => {
    const p = await makeProject();
    createUserTerminal({ projectId: p.id });
    const db = getDb();
    db.delete(projects).run();
    expect(listUserTerminals(p.id)).toHaveLength(0);
  });

  it("orders by position before createdAt", async () => {
    const p = await makeProject();
    const a = createUserTerminal({ projectId: p.id });
    const b = createUserTerminal({ projectId: p.id });
    const c = createUserTerminal({ projectId: p.id });
    // Reverse the positions so createdAt and position disagree.
    const db = getDb();
    db.update(userTerminals).set({ position: 2 }).where(eq(userTerminals.id, a.id)).run();
    db.update(userTerminals).set({ position: 1 }).where(eq(userTerminals.id, b.id)).run();
    db.update(userTerminals).set({ position: 0 }).where(eq(userTerminals.id, c.id)).run();
    expect(listUserTerminals(p.id).map((t) => t.id)).toEqual([c.id, b.id, a.id]);
  });

  it("createUserTerminal throws when projectId does not exist", async () => {
    expect(() => createUserTerminal({ projectId: "does-not-exist" })).toThrow();
  });
});
