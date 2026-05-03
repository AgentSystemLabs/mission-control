import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as schema from "./schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS } from "~/shared/domain";

const migrationFiles = import.meta.glob("./migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function resolveUserDataDir(): string {
  if (process.env.MC_USER_DATA_DIR) return process.env.MC_USER_DATA_DIR;
  const platform = process.platform;
  const home = os.homedir();
  if (platform === "darwin") return path.join(home, "Library/Application Support/MissionControl");
  if (platform === "win32") return path.join(home, "AppData/Roaming/MissionControl");
  return path.join(home, ".config/MissionControl");
}

export function getDb() {
  if (_db) return _db;
  const dir = resolveUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "missioncontrol.db");
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _db = drizzle(_sqlite, { schema });
  const freshBootstrap = !tableExists(_sqlite, "projects");
  ensureSchema(_sqlite);
  runMigrations(_sqlite, { markAllAppliedOnly: freshBootstrap });
  // PTYs are owned by the Electron process and are not restored across app
  // restarts. Any task left as running after a restart is stale.
  _sqlite
    .prepare("UPDATE tasks SET status = 'disconnected', updated_at = ? WHERE status = 'running'")
    .run(Date.now());
  // Launch-spawned user terminals are session-only: their PTY died with the
  // previous app process, so the persisted row would respawn the command on
  // next visit and look like the run "survived" the restart. Drop them.
  _sqlite.prepare("DELETE FROM user_terminals WHERE start_command IS NOT NULL").run();
  return _db;
}

/**
 * Apply versioned SQL migrations from ./migrations, tracking what's been
 * applied in the `schema_migrations` table. ensureSchema handles the initial
 * table layout; this runner is for incremental data/schema changes after that.
 */
function runMigrations(
  sqlite: Database.Database,
  opts: { markAllAppliedOnly?: boolean } = {}
) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    sqlite
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((r: any) => r.name as string)
  );
  const names = Object.keys(migrationFiles)
    .map((p) => p.split("/").pop()!)
    .sort();
  if (opts.markAllAppliedOnly) {
    const now = Date.now();
    for (const name of names) {
      if (applied.has(name)) continue;
      sqlite
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(name, now);
    }
    return;
  }
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = migrationFiles[`./migrations/${name}`];
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(name, Date.now());
    });
    tx();
  }
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return !!row;
}

export function getSqlite() {
  if (!_sqlite) getDb();
  return _sqlite!;
}

/**
 * Inline schema bootstrap so we don't ship migration files to the user.
 * Drizzle Kit migrations remain useful in dev for tracking diffs, but for the
 * embedded SQLite we always idempotently CREATE IF NOT EXISTS on first open.
 */
function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      icon TEXT NOT NULL,
      icon_color TEXT NOT NULL,
      image_path TEXT,
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      branch TEXT NOT NULL DEFAULT '${DEFAULT_BRANCH}',
      launch_commands TEXT,
      launch_url TEXT,
      remember_agent_settings INTEGER NOT NULL DEFAULT 0,
      saved_agent TEXT,
      saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
      saved_bare_session INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_group_idx ON projects(group_id);
    CREATE INDEX IF NOT EXISTS projects_pinned_idx ON projects(pinned);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '${DEFAULT_TASK_STATUS}',
      branch TEXT NOT NULL DEFAULT '${DEFAULT_BRANCH}',
      preview TEXT NOT NULL DEFAULT '',
      lines INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      claude_session_id TEXT,
      claude_skip_permissions INTEGER NOT NULL DEFAULT 0,
      claude_bare_session INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_archived_idx ON tasks(archived);

    CREATE TABLE IF NOT EXISTS terminal_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      chunk TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS terminal_logs_task_idx ON terminal_logs(task_id);

    CREATE TABLE IF NOT EXISTS user_terminals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cwd TEXT,
      start_command TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_terminals_project_idx ON user_terminals(project_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      claude_session_id TEXT NOT NULL,
      message_uuid TEXT NOT NULL UNIQUE,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS token_usage_task_idx ON token_usage(task_id);
    CREATE INDEX IF NOT EXISTS token_usage_project_idx ON token_usage(project_id);
    CREATE INDEX IF NOT EXISTS token_usage_ts_idx ON token_usage(ts);

    CREATE TABLE IF NOT EXISTS token_usage_session_offsets (
      claude_session_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
}

export { schema };
