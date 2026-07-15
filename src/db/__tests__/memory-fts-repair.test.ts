import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { ensureMemoryFts, repairMemoryFtsIfCorrupt } from "../client";

// Regression for the field bug where removing a project failed with "database
// disk image is malformed". Deleting a project cascades into project_memory,
// whose AFTER DELETE trigger syncs the FTS5 index — so a corrupt/desynced index
// made project deletion (and every memory edit) throw, not just search. The fix
// self-heals the index on boot; these tests exercise that repair directly.

// Minimal project_memory table matching the columns ensureMemoryFts indexes.
function memoryDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE project_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT
    );
  `);
  return d;
}

function addMemory(d: Database.Database, id: string): void {
  d.prepare(
    "INSERT INTO project_memory (id, project_id, title, body, tags) VALUES (?, ?, ?, ?, ?)",
  ).run(id, "p1", `title-${id}`, `body-${id}`, "");
}

function ftsIsHealthy(d: Database.Database): boolean {
  try {
    d.prepare(
      "INSERT INTO project_memory_fts(project_memory_fts, rank) VALUES ('integrity-check', 1)",
    ).run();
    return true;
  } catch {
    return false;
  }
}

// Reproduce the on-disk state we saw in the field: a content row the FTS index
// doesn't know about. Dropping the AFTER INSERT trigger, inserting a row, then
// restoring the trigger leaves the index out of sync with project_memory — the
// exact state whose AFTER DELETE trigger throws SQLITE_CORRUPT.
function forceFtsDesync(d: Database.Database): void {
  d.exec("DROP TRIGGER project_memory_fts_ai");
  d.prepare(
    "INSERT INTO project_memory (id, project_id, title, body, tags) VALUES (?, ?, ?, ?, ?)",
  ).run("m-ghost", "p1", "ghost", "row", "");
  d.exec(`
    CREATE TRIGGER project_memory_fts_ai
    AFTER INSERT ON project_memory BEGIN
      INSERT INTO project_memory_fts(rowid, title, body, tags)
      VALUES (new.rowid, new.title, new.body, COALESCE(new.tags, ''));
    END;
  `);
}

describe("project_memory FTS self-heal", () => {
  it("reports ok for a healthy index", () => {
    const d = memoryDb();
    expect(ensureMemoryFts(d)).toBe(true);
    addMemory(d, "m1");
    expect(repairMemoryFtsIfCorrupt(d)).toBe("ok");
  });

  it("detects a corrupt/desynced index and rebuilds it", () => {
    const d = memoryDb();
    ensureMemoryFts(d);
    addMemory(d, "m1");
    forceFtsDesync(d);
    expect(ftsIsHealthy(d)).toBe(false); // guard: the desync is real

    expect(repairMemoryFtsIfCorrupt(d)).toBe("rebuilt");
    expect(ftsIsHealthy(d)).toBe(true);
  });

  it("unblocks memory deletion after repair — the field bug", () => {
    const d = memoryDb();
    ensureMemoryFts(d);
    addMemory(d, "m1");
    forceFtsDesync(d);

    // Before repair the AFTER DELETE trigger writing to the corrupt index throws.
    expect(() =>
      d.prepare("DELETE FROM project_memory WHERE project_id = ?").run("p1"),
    ).toThrow();

    repairMemoryFtsIfCorrupt(d);

    // After repair the same cascade-style delete succeeds.
    expect(() =>
      d.prepare("DELETE FROM project_memory WHERE project_id = ?").run("p1"),
    ).not.toThrow();
    expect(
      (d.prepare("SELECT count(*) AS n FROM project_memory").get() as { n: number }).n,
    ).toBe(0);
  });

  it("ensureMemoryFts self-heals a corrupt index on the next boot", () => {
    const d = memoryDb();
    ensureMemoryFts(d); // first boot: create index + triggers
    addMemory(d, "m1");
    forceFtsDesync(d);
    expect(ftsIsHealthy(d)).toBe(false);

    expect(ensureMemoryFts(d)).toBe(true); // second boot repairs in passing
    expect(ftsIsHealthy(d)).toBe(true);
  });

  it("returns unavailable when the FTS table does not exist", () => {
    const d = memoryDb(); // no ensureMemoryFts → no project_memory_fts
    expect(repairMemoryFtsIfCorrupt(d)).toBe("unavailable");
  });
});
