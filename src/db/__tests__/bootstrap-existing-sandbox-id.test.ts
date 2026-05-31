import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { ensureColumn, ensureProjectSandboxIndex } from "../client";

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

function projectIndexes(d: Database.Database): Array<{ name: string; unique: number }> {
  return d.prepare("PRAGMA index_list(projects)").all() as Array<{ name: string; unique: number }>;
}

function createCurrentProjectsTable(
  d: Database.Database,
  sandboxColumnDdl: string,
  pathColumnDdl = "TEXT NOT NULL",
  extraTableSql = "",
) {
  d.exec(`
    CREATE TABLE groups (id TEXT PRIMARY KEY);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path ${pathColumnDdl},
      icon TEXT NOT NULL,
      icon_color TEXT NOT NULL,
      image_path TEXT,
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      sandbox_id ${sandboxColumnDdl},
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_order INTEGER,
      branch TEXT NOT NULL DEFAULT 'main',
      launch_commands TEXT,
      launch_url TEXT,
      worktree_setup_command TEXT,
      remember_agent_settings INTEGER NOT NULL DEFAULT 0,
      saved_agent TEXT,
      saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
      saved_bare_session INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
      ${extraTableSql}
    );
  `);
}

function insertProject(d: Database.Database, id: string, sandboxId: string, projectPath = `/tmp/${id}`) {
  d.prepare(`
    INSERT INTO projects (
      id, name, path, icon, icon_color, sandbox_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'PR', '#fff', ?, 1, 1)
  `).run(id, id, projectPath, sandboxId);
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

  it("drops a legacy explicit unique sandbox_id index", () => {
    const d = db();
    createCurrentProjectsTable(d, "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE");
    d.exec(`CREATE UNIQUE INDEX legacy_projects_sandbox_unique ON projects(sandbox_id);`);
    d.prepare("INSERT INTO sandboxes (id) VALUES ('sb-1')").run();
    insertProject(d, "p1", "sb-1");

    ensureProjectSandboxIndex(d);

    insertProject(d, "p2", "sb-1");
    expect(projectIndexes(d).some((idx) => idx.name === "legacy_projects_sandbox_unique")).toBe(false);
    expect(projectIndexes(d).find((idx) => idx.name === "projects_sandbox_idx")?.unique).toBe(0);
  });

  it("rebuilds a legacy inline unique sandbox_id column", () => {
    const d = db();
    d.pragma("foreign_keys = ON");
    createCurrentProjectsTable(d, "TEXT UNIQUE REFERENCES sandboxes(id) ON DELETE CASCADE");
    d.exec(`
      ALTER TABLE projects ADD COLUMN sandbox_state TEXT DEFAULT 'legacy';
      CREATE INDEX projects_path_idx ON projects(path);
      CREATE TABLE project_children (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
      );
    `);
    d.prepare("INSERT INTO sandboxes (id) VALUES ('sb-1')").run();
    insertProject(d, "p1", "sb-1");
    d.prepare("INSERT INTO project_children (id, project_id) VALUES ('child-1', 'p1')").run();

    ensureProjectSandboxIndex(d);

    insertProject(d, "p2", "sb-1");
    expect(projectIndexes(d).find((idx) => idx.name === "projects_sandbox_idx")?.unique).toBe(0);
    expect(projectIndexes(d).some((idx) => idx.name === "projects_path_idx")).toBe(true);
    expect(projectColumns(d)).toContain("sandbox_state");
    expect(d.prepare("SELECT sandbox_state FROM projects WHERE id = 'p1'").get()).toEqual({
      sandbox_state: "legacy",
    });
    expect(d.prepare("SELECT COUNT(*) AS c FROM project_children").get()).toEqual({ c: 1 });
    expect(d.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rebuilds a legacy table-level unique sandbox_id constraint", () => {
    const d = db();
    createCurrentProjectsTable(
      d,
      "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE",
      "TEXT NOT NULL",
      ", UNIQUE(sandbox_id)",
    );
    d.prepare("INSERT INTO sandboxes (id) VALUES ('sb-1')").run();
    insertProject(d, "p1", "sb-1");

    ensureProjectSandboxIndex(d);

    insertProject(d, "p2", "sb-1");
    expect(projectIndexes(d).find((idx) => idx.name === "projects_sandbox_idx")?.unique).toBe(0);
  });

  it("drops a legacy explicit unique path index", () => {
    const d = db();
    createCurrentProjectsTable(d, "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE");
    d.exec(`CREATE UNIQUE INDEX legacy_projects_path_unique ON projects(path);`);
    d.prepare("INSERT INTO sandboxes (id) VALUES ('sb-1')").run();
    insertProject(d, "p-local", "sb-1", "/tmp/repo");

    ensureProjectSandboxIndex(d);

    insertProject(d, "p-sandbox", "sb-1", "/tmp/repo");
    expect(projectIndexes(d).some((idx) => idx.name === "legacy_projects_path_unique")).toBe(false);
  });

  it("rebuilds a legacy inline unique path column", () => {
    const d = db();
    createCurrentProjectsTable(
      d,
      "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE",
      "TEXT NOT NULL UNIQUE",
    );
    d.prepare("INSERT INTO sandboxes (id) VALUES ('sb-1')").run();
    insertProject(d, "p-local", "sb-1", "/tmp/repo");

    ensureProjectSandboxIndex(d);

    insertProject(d, "p-sandbox", "sb-1", "/tmp/repo");
    expect(projectIndexes(d).find((idx) => idx.name === "projects_sandbox_idx")?.unique).toBe(0);
  });
});
