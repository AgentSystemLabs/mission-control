import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { ensureColumn } from "../client";

// The bootstrap adds projects.sandbox_id via ensureColumn. A schema-divergent
// DB (e.g. an installed build's cloud-runtime feature) may already define that
// column — ensureColumn must be a no-op there, not crash with "duplicate column
// name". This guards the exact failure that broke dev when it shared the
// installed app's database.
function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE sandboxes (id TEXT PRIMARY KEY);`);
  return d;
}

function projectColumns(d: Database.Database): string[] {
  return (d.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
}

describe("ensureColumn", () => {
  it("adds the column when missing", () => {
    const d = db();
    d.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
    expect(projectColumns(d)).not.toContain("sandbox_id");
    ensureColumn(d, "projects", "sandbox_id", "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE");
    expect(projectColumns(d)).toContain("sandbox_id");
  });

  it("is a no-op (no throw) when the column already exists", () => {
    const d = db();
    d.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, sandbox_id TEXT, sandbox_state TEXT);`);
    expect(() =>
      ensureColumn(d, "projects", "sandbox_id", "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE"),
    ).not.toThrow();
    // Still exactly one sandbox_id column — not duplicated.
    expect(projectColumns(d).filter((c) => c === "sandbox_id")).toHaveLength(1);
  });

  it("is idempotent across repeated runs", () => {
    const d = db();
    d.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
    ensureColumn(d, "projects", "sandbox_id", "TEXT");
    expect(() => ensureColumn(d, "projects", "sandbox_id", "TEXT")).not.toThrow();
    expect(projectColumns(d).filter((c) => c === "sandbox_id")).toHaveLength(1);
  });
});
