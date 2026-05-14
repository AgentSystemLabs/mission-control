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
  getUserTerminalProjectId,
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
    const a = await createUserTerminal({ projectId: p.id });
    const b = await createUserTerminal({ projectId: p.id });
    expect(a.id).toMatch(/^ut-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a.name).toBe("Terminal 1");
    expect(b.name).toBe("Terminal 2");
    const list = await listUserTerminals(p.id);
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("creates the first available default name when terminal numbers have gaps", async () => {
    const p = await makeProject();
    const db = getDb();
    const now = Date.now();
    db.insert(userTerminals)
      .values([
        {
          id: "ut-gap-1",
          projectId: p.id,
          name: "Terminal 1",
          cwd: null,
          startCommand: null,
          position: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "ut-gap-3",
          projectId: p.id,
          name: "Terminal 3",
          cwd: null,
          startCommand: null,
          position: 1,
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ])
      .run();

    const terminal = await createUserTerminal({ projectId: p.id });

    expect(terminal.name).toBe("Terminal 2");
  });

  it("renames", async () => {
    const p = await makeProject();
    const t = await createUserTerminal({ projectId: p.id });
    const renamed = await renameUserTerminal(t.id, "  dev server  ");
    expect(renamed?.name).toBe("dev server");
  });

  it("rejects empty rename", async () => {
    const p = await makeProject();
    const t = await createUserTerminal({ projectId: p.id });
    await expect(renameUserTerminal(t.id, "   ")).rejects.toThrow();
  });

  it("deletes only the targeted row", async () => {
    const p = await makeProject();
    const a = await createUserTerminal({ projectId: p.id });
    const b = await createUserTerminal({ projectId: p.id });
    expect(await deleteUserTerminal(a.id)).toBe(true);
    const remaining = await listUserTerminals(p.id);
    expect(remaining.map((t) => t.id)).toEqual([b.id]);
  });

  it("scopes terminals per project", async () => {
    const p1 = await makeProject();
    const p2 = await makeProject();
    await createUserTerminal({ projectId: p1.id });
    await createUserTerminal({ projectId: p2.id });
    expect(await listUserTerminals(p1.id)).toHaveLength(1);
    expect(await listUserTerminals(p2.id)).toHaveLength(1);
  });

  it("persists launch-created terminal ownership while hiding it from the user list", async () => {
    const p = await makeProject();
    const terminal = await createUserTerminal({
      projectId: p.id,
      name: "Dev server",
      cwd: p.path,
      startCommand: "pnpm dev",
    });

    expect(terminal.startCommand).toBe("pnpm dev");
    expect(await listUserTerminals(p.id)).toHaveLength(0);
    expect(await getUserTerminalProjectId(terminal.id)).toBe(p.id);
    expect(getDb().select().from(userTerminals).where(eq(userTerminals.id, terminal.id)).get()).toBeTruthy();
  });

  it("clears launch-created terminal ownership when purged", async () => {
    const p = await makeProject();
    const terminal = await createUserTerminal({
      projectId: p.id,
      name: "Dev server",
      cwd: p.path,
      startCommand: "pnpm dev",
    });

    expect(await getUserTerminalProjectId(terminal.id)).toBe(p.id);
    await purgeLaunchSpawnedTerminals(p.id);
    expect(await getUserTerminalProjectId(terminal.id)).toBeNull();
  });

  it("deletes launch-created terminals", async () => {
    const p = await makeProject();
    const terminal = await createUserTerminal({
      projectId: p.id,
      name: "Dev server",
      cwd: p.path,
      startCommand: "pnpm dev",
    });

    expect(await deleteUserTerminal(terminal.id)).toBe(true);
    expect(await getUserTerminalProjectId(terminal.id)).toBeNull();
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
    expect(await listUserTerminals(p.id)).toHaveLength(0);
    // Explicit purge (what boot now calls) is what actually deletes them.
    expect(await purgeLaunchSpawnedTerminals()).toBeGreaterThanOrEqual(1);
    expect(db.select().from(userTerminals).all()).toHaveLength(0);
  });

  it("cascades on project delete", async () => {
    const p = await makeProject();
    await createUserTerminal({ projectId: p.id });
    const db = getDb();
    db.delete(projects).run();
    expect(await listUserTerminals(p.id)).toHaveLength(0);
  });

  it("orders by position before createdAt", async () => {
    const p = await makeProject();
    const a = await createUserTerminal({ projectId: p.id });
    const b = await createUserTerminal({ projectId: p.id });
    const c = await createUserTerminal({ projectId: p.id });
    // Reverse the positions so createdAt and position disagree.
    const db = getDb();
    db.update(userTerminals).set({ position: 2 }).where(eq(userTerminals.id, a.id)).run();
    db.update(userTerminals).set({ position: 1 }).where(eq(userTerminals.id, b.id)).run();
    db.update(userTerminals).set({ position: 0 }).where(eq(userTerminals.id, c.id)).run();
    expect((await listUserTerminals(p.id)).map((t) => t.id)).toEqual([c.id, b.id, a.id]);
  });

  it("createUserTerminal throws when projectId does not exist", async () => {
    await expect(createUserTerminal({ projectId: "does-not-exist" })).rejects.toThrow();
  });
});
