import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import {
  migrateMultiSandbox,
  SANDBOXES_ENABLED_KEY,
  ACTIVE_SCOPE_KEY,
} from "../migrate-multi-sandbox";

// Minimal slice of the schema the migration touches.
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sandboxes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'remote-vm',
      color TEXT, image_tag TEXT, dockerfile_path TEXT, build_args TEXT,
      git_auth_mode TEXT NOT NULL DEFAULT 'none', declared_ports TEXT, env TEXT,
      host_agent_port INTEGER, port_map TEXT, pairing_token TEXT, remote_config TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      sandbox_id TEXT REFERENCES sandboxes(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function set(db: Database.Database, key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
}
function get(db: Database.Database, key: string): string | null {
  return (
    (db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined)?.value ?? null
  );
}
function seedProjects(db: Database.Database, n: number) {
  for (let i = 0; i < n; i++) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(`p${i}`, `P${i}`, `/x/${i}`);
  }
}

describe("migrateMultiSandbox", () => {
  it("moves a docker user's projects into a Default sandbox and seeds active scope", () => {
    const db = freshDb();
    set(db, "sandbox.enabled", "true");
    set(db, "sandbox.runtimeMode", "docker");
    set(db, "sandbox.imageTag", "acme/img:1");
    set(db, "sandbox.gitAuthMode", "generate");
    set(db, "sandbox.publishedPorts", "[3000,5173]");
    set(db, "sandbox.agentPort", "9333");
    set(db, "sandbox.pairingToken", "tok-123");
    seedProjects(db, 3);

    migrateMultiSandbox(db);

    const sandboxes = db.prepare("SELECT * FROM sandboxes").all() as any[];
    expect(sandboxes).toHaveLength(1);
    const sb = sandboxes[0];
    expect(sb.name).toBe("Default");
    expect(sb.kind).toBe("remote-vm");
    expect(sb.image_tag).toBe("acme/img:1");
    expect(sb.git_auth_mode).toBe("generate");
    expect(sb.declared_ports).toBe("[3000,5173]");
    expect(sb.host_agent_port).toBe(9333);
    expect(sb.pairing_token).toBe("tok-123");

    const scoped = db
      .prepare("SELECT COUNT(*) AS c FROM projects WHERE sandbox_id = ?")
      .get(sb.id) as { c: number };
    expect(scoped.c).toBe(3); // all existing projects reassigned to Default

    expect(get(db, SANDBOXES_ENABLED_KEY)).toBe("true");
    expect(get(db, ACTIVE_SCOPE_KEY)).toBe(sb.id);
    expect(get(db, "multiSandbox.migrated")).toBe("true");
  });

  it("keeps a host user on Local (no sandbox created)", () => {
    const db = freshDb();
    set(db, "sandbox.enabled", "false"); // host runtime / sandbox off
    seedProjects(db, 2);

    migrateMultiSandbox(db);

    expect(db.prepare("SELECT COUNT(*) AS c FROM sandboxes").get()).toEqual({ c: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM projects WHERE sandbox_id IS NULL").get(),
    ).toEqual({ c: 2 });
    expect(get(db, SANDBOXES_ENABLED_KEY)).toBe("false");
    expect(get(db, ACTIVE_SCOPE_KEY)).toBe("local");
  });

  it("treats enabled-but-host (runtimeMode != docker) as Local", () => {
    const db = freshDb();
    set(db, "sandbox.enabled", "true");
    set(db, "sandbox.runtimeMode", "host");
    seedProjects(db, 1);

    migrateMultiSandbox(db);

    expect(db.prepare("SELECT COUNT(*) AS c FROM sandboxes").get()).toEqual({ c: 0 });
    expect(get(db, ACTIVE_SCOPE_KEY)).toBe("local");
    expect(get(db, SANDBOXES_ENABLED_KEY)).toBe("true");
  });

  it("is idempotent (second run is a no-op)", () => {
    const db = freshDb();
    set(db, "sandbox.enabled", "true");
    set(db, "sandbox.runtimeMode", "docker");
    seedProjects(db, 1);

    migrateMultiSandbox(db);
    const firstId = get(db, ACTIVE_SCOPE_KEY);
    migrateMultiSandbox(db);

    expect(db.prepare("SELECT COUNT(*) AS c FROM sandboxes").get()).toEqual({ c: 1 });
    expect(get(db, ACTIVE_SCOPE_KEY)).toBe(firstId);
  });
});
