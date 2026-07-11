import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { reconcileStaleSessionsOnBoot } from "../client";

// Minimal slice of the tasks schema the reconciliation touches.
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function seed(db: Database.Database, id: string, status: string) {
  db.prepare("INSERT INTO tasks (id, status, updated_at) VALUES (?, ?, 0)").run(id, status);
}

function statusOf(db: Database.Database, id: string): string {
  return (db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status;
}

describe("reconcileStaleSessionsOnBoot", () => {
  it("resets running and needs-input tasks to disconnected (their PTYs died with the app)", () => {
    const db = freshDb();
    seed(db, "run", "running");
    seed(db, "blocked", "needs-input");

    reconcileStaleSessionsOnBoot(db);

    expect(statusOf(db, "run")).toBe("disconnected");
    // The regression: a needs-input row used to survive a restart and keep the
    // pet alerting forever. It must now be reconciled too.
    expect(statusOf(db, "blocked")).toBe("disconnected");
  });

  it("leaves ready and terminal/idle statuses untouched", () => {
    const db = freshDb();
    for (const s of ["ready", "finished", "terminated", "interrupted", "disconnected"]) {
      seed(db, s, s);
    }

    reconcileStaleSessionsOnBoot(db);

    for (const s of ["ready", "finished", "terminated", "interrupted", "disconnected"]) {
      expect(statusOf(db, s)).toBe(s);
    }
  });

  it("stamps updated_at on reconciled rows", () => {
    const db = freshDb();
    seed(db, "blocked", "needs-input");

    reconcileStaleSessionsOnBoot(db);

    const updatedAt = (db.prepare("SELECT updated_at FROM tasks WHERE id = 'blocked'").get() as {
      updated_at: number;
    }).updated_at;
    expect(updatedAt).toBeGreaterThan(0);
  });
});
