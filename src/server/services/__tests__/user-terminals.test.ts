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
  nextDefaultTerminalName,
} = await import("../user-terminals");
const { getDb } = await import("~/db/client");
const { projects, tasks, userTerminals, worktrees, sandboxes } = await import("~/db/schema");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ut-"));
  return createProject({ name: "p", path: dir });
}

describe("user-terminals service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(userTerminals).run();
    db.delete(worktrees).run();
    db.delete(tasks).run();
    db.delete(projects).run();
    db.delete(sandboxes).run();
  });

  it("creates with default name and lists in insertion order", () => {
    const p = makeProject();
    const a = createUserTerminal({ projectId: p.id });
    const b = createUserTerminal({ projectId: p.id });
    expect(a.name).toBe("Terminal 1");
    expect(b.name).toBe("Terminal 2");
    const list = listUserTerminals(p.id);
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("renames", () => {
    const p = makeProject();
    const t = createUserTerminal({ projectId: p.id });
    const renamed = renameUserTerminal(t.id, "  dev server  ");
    expect(renamed?.name).toBe("dev server");
  });

  it("rejects empty rename", () => {
    const p = makeProject();
    const t = createUserTerminal({ projectId: p.id });
    expect(() => renameUserTerminal(t.id, "   ")).toThrow();
  });

  it("deletes only the targeted row", () => {
    const p = makeProject();
    const a = createUserTerminal({ projectId: p.id });
    const b = createUserTerminal({ projectId: p.id });
    expect(deleteUserTerminal(a.id)).toBe(true);
    const remaining = listUserTerminals(p.id);
    expect(remaining.map((t) => t.id)).toEqual([b.id]);
  });

  it("scopes terminals per project", () => {
    const p1 = makeProject();
    const p2 = makeProject();
    createUserTerminal({ projectId: p1.id });
    createUserTerminal({ projectId: p2.id });
    expect(listUserTerminals(p1.id)).toHaveLength(1);
    expect(listUserTerminals(p2.id)).toHaveLength(1);
  });

  it("scopes terminals per sandbox runtime", () => {
    const p = makeProject();
    const now = Date.now();
    getDb()
      .insert(sandboxes)
      .values({
        id: "sb-1",
        name: "Sandbox",
        kind: "remote-vm",
        color: null,
        imageTag: null,
        dockerfilePath: null,
        buildArgs: null,
        gitAuthMode: "none",
        copyAgentCreds: false,
        declaredPorts: null,
        env: null,
        hostAgentPort: null,
        portMap: null,
        pairingToken: null,
        remoteConfig: JSON.stringify({ agentUrl: "wss://agent.example.com/", projectId: p.id }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    createUserTerminal({ projectId: p.id, scopeId: "local" });
    createUserTerminal({ projectId: p.id, scopeId: "sb-1" });

    expect(listUserTerminals(p.id, "local").map((t) => t.scopeId)).toEqual(["local"]);
    expect(listUserTerminals(p.id, "sb-1").map((t) => t.scopeId)).toEqual(["sb-1"]);
  });

  it("rejects terminals for an unknown sandbox scope", () => {
    const p = makeProject();
    expect(() => createUserTerminal({ projectId: p.id, scopeId: "sb-missing" })).toThrow(
      "Sandbox scope does not exist",
    );
  });

  it("does not persist launch-created terminals", () => {
    const p = makeProject();
    const terminal = createUserTerminal({
      projectId: p.id,
      name: "Dev server",
      cwd: p.path,
      startCommand: "pnpm dev",
    });

    expect(terminal.startCommand).toBe("pnpm dev");
    expect(listUserTerminals(p.id)).toHaveLength(0);
  });

  it("cleans stale launch-created terminals from older app versions", () => {
    const p = makeProject();
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

    expect(listUserTerminals(p.id)).toHaveLength(0);
    expect(db.select().from(userTerminals).all()).toHaveLength(0);
  });

  it("cascades on project delete", () => {
    const p = makeProject();
    createUserTerminal({ projectId: p.id });
    const db = getDb();
    db.delete(projects).run();
    expect(listUserTerminals(p.id)).toHaveLength(0);
  });

  it("orders by position before createdAt", () => {
    const p = makeProject();
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

  it("createUserTerminal throws when projectId does not exist", () => {
    expect(() => createUserTerminal({ projectId: "does-not-exist" })).toThrow();
  });

  it("accepts a client-provided id for warm-pool adoption", () => {
    const p = makeProject();
    const clientId = "ut-mabc123-abcdef";
    const terminal = createUserTerminal({ projectId: p.id, id: clientId });
    expect(terminal.id).toBe(clientId);
    expect(listUserTerminals(p.id).some((t) => t.id === clientId)).toBe(true);
  });

  it("reuses the lowest free Terminal N after a gap", () => {
    const p = makeProject();
    const first = createUserTerminal({ projectId: p.id });
    createUserTerminal({ projectId: p.id });
    deleteUserTerminal(first.id);
    expect(nextDefaultTerminalName(p.id)).toBe("Terminal 1");
    const next = createUserTerminal({ projectId: p.id });
    expect(next.name).toBe("Terminal 1");
  });

  it("avoids project-wide name collisions when creating in a worktree", () => {
    const p = makeProject();
    createUserTerminal({ projectId: p.id, worktreeId: null });
    const db = getDb();
    const now = Date.now();
    db.insert(worktrees)
      .values({
        id: "wt-setup",
        projectId: p.id,
        name: "setup",
        path: p.path,
        branch: "feature/setup",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const wt = createUserTerminal({ projectId: p.id, worktreeId: "wt-setup" });
    expect(wt.name).toBe("Terminal 2");
  });
});
