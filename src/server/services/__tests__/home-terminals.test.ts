import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-home-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const {
  listHomeTerminals,
  createHomeTerminal,
  renameHomeTerminal,
  deleteHomeTerminal,
} = await import("../home-terminals");
const { getDb } = await import("~/db/client");
const { homeTerminals } = await import("~/db/schema");
const { HOME_TERMINAL_PROJECT_ID } = await import("~/shared/home-terminal");

describe("home-terminals service", () => {
  beforeEach(() => {
    getDb().delete(homeTerminals).run();
  });

  it("creates with default name and lists in insertion order", () => {
    const a = createHomeTerminal({});
    const b = createHomeTerminal({});
    expect(a.name).toBe("Terminal 1");
    expect(b.name).toBe("Terminal 2");
    expect(listHomeTerminals().map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("shapes rows as UserTerminal with the home sentinel projectId and no worktree/startCommand", () => {
    const t = createHomeTerminal({ name: "scratch" });
    expect(t.projectId).toBe(HOME_TERMINAL_PROJECT_ID);
    expect(t.worktreeId).toBeNull();
    expect(t.startCommand).toBeNull();
    expect(t.name).toBe("scratch");
  });

  it("is independent of any project (no project row required)", () => {
    // Unlike user terminals, home terminals never validate a project exists.
    const t = createHomeTerminal({});
    expect(listHomeTerminals().map((x) => x.id)).toEqual([t.id]);
  });

  it("renames and trims", () => {
    const t = createHomeTerminal({});
    const renamed = renameHomeTerminal(t.id, "  dev box  ");
    expect(renamed?.name).toBe("dev box");
    expect(listHomeTerminals()[0]!.name).toBe("dev box");
  });

  it("rejects empty rename", () => {
    const t = createHomeTerminal({});
    expect(() => renameHomeTerminal(t.id, "   ")).toThrow();
  });

  it("returns null when renaming a missing terminal", () => {
    expect(renameHomeTerminal("ht-missing-000000", "x")).toBeNull();
  });

  it("deletes only the targeted row", () => {
    const a = createHomeTerminal({});
    const b = createHomeTerminal({});
    expect(deleteHomeTerminal(a.id)).toBe(true);
    expect(listHomeTerminals().map((t) => t.id)).toEqual([b.id]);
  });

  it("reports false when deleting a missing terminal", () => {
    expect(deleteHomeTerminal("ht-missing-000000")).toBe(false);
  });

  it("reuses the lowest free Terminal N after a gap", () => {
    const first = createHomeTerminal({});
    createHomeTerminal({});
    deleteHomeTerminal(first.id);
    expect(createHomeTerminal({}).name).toBe("Terminal 1");
  });

  it("accepts a client-provided domain id", () => {
    const clientId = "ht-mabc123-abcdef";
    const t = createHomeTerminal({ id: clientId });
    expect(t.id).toBe(clientId);
  });

  it("rejects an invalid client id", () => {
    expect(() => createHomeTerminal({ id: "not a domain id" })).toThrow();
  });

  it("scopes terminals per sandbox", () => {
    createHomeTerminal({ scopeId: "sb-a" });
    createHomeTerminal({ scopeId: "sb-a" });
    createHomeTerminal({ scopeId: "sb-b" });
    expect(listHomeTerminals("sb-a")).toHaveLength(2);
    expect(listHomeTerminals("sb-b")).toHaveLength(1);
    expect(listHomeTerminals("local")).toHaveLength(0);
    // Unscoped list defaults to the local scope.
    expect(listHomeTerminals()).toHaveLength(0);
  });

  it("numbers default names independently per scope", () => {
    const a = createHomeTerminal({ scopeId: "sb-a" });
    const b = createHomeTerminal({ scopeId: "sb-b" });
    // Each scope starts its own Terminal 1 rather than continuing a global count.
    expect(a.name).toBe("Terminal 1");
    expect(b.name).toBe("Terminal 1");
  });

  it("deleting a terminal in one scope leaves other scopes untouched", () => {
    const a = createHomeTerminal({ scopeId: "sb-a" });
    createHomeTerminal({ scopeId: "sb-b" });
    expect(deleteHomeTerminal(a.id)).toBe(true);
    expect(listHomeTerminals("sb-a")).toHaveLength(0);
    expect(listHomeTerminals("sb-b")).toHaveLength(1);
  });

  it("orders by position before createdAt", () => {
    const a = createHomeTerminal({});
    const b = createHomeTerminal({});
    const c = createHomeTerminal({});
    const db = getDb();
    db.update(homeTerminals).set({ position: 2 }).where(eq(homeTerminals.id, a.id)).run();
    db.update(homeTerminals).set({ position: 1 }).where(eq(homeTerminals.id, b.id)).run();
    db.update(homeTerminals).set({ position: 0 }).where(eq(homeTerminals.id, c.id)).run();
    expect(listHomeTerminals().map((t) => t.id)).toEqual([c.id, b.id, a.id]);
  });
});
