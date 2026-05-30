import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as schema from "./schema";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";
import { migrateMultiSandbox } from "./migrate-multi-sandbox";
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

export function resolveSkillsDir(): string {
  return path.join(resolveUserDataDir(), "skills");
}

export function getDb() {
  if (_db) return _db;
  const dir = resolveUserDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "missioncontrol.db");
  _sqlite = new Database(dbPath, {
    nativeBinding: resolveElectronBetterSqlite3NativeBinding(),
  });
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _db = drizzle(_sqlite, { schema });
  const freshBootstrap = !tableExists(_sqlite, "projects");
  if (freshBootstrap) {
    ensureSchema(_sqlite);
    runMigrations(_sqlite, { markAllAppliedOnly: true });
  } else {
    runMigrations(_sqlite);
    ensureSchema(_sqlite);
  }
  // One-time parity migration to the multi-sandbox model (idempotent; reads the
  // legacy sandbox.* app_settings). Runs after schema is guaranteed present.
  migrateMultiSandbox(_sqlite);
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

/**
 * Idempotently add a column to an existing table. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we check pragma table_info first — this makes
 * the bootstrap safe even against a DB that already has the column (e.g. a
 * schema-divergent build that defined its own `sandbox_id`), instead of throwing
 * "duplicate column name". `table`/`column` are internal constants, not input.
 */
export function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
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

    CREATE TABLE IF NOT EXISTS sandboxes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'local-docker',
      color TEXT,
      image_tag TEXT,
      dockerfile_path TEXT,
      build_args TEXT,
      git_auth_mode TEXT NOT NULL DEFAULT 'none',
      declared_ports TEXT,
      env TEXT,
      host_agent_port INTEGER,
      port_map TEXT,
      pairing_token TEXT,
      remote_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      icon TEXT NOT NULL,
      icon_color TEXT NOT NULL,
      image_path TEXT,
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      sandbox_id TEXT REFERENCES sandboxes(id) ON DELETE CASCADE,
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_order INTEGER,
      branch TEXT NOT NULL DEFAULT '${DEFAULT_BRANCH}',
      launch_commands TEXT,
      launch_url TEXT,
      worktree_setup_command TEXT,
      remember_agent_settings INTEGER NOT NULL DEFAULT 0,
      saved_agent TEXT,
      saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
      saved_bare_session INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_group_idx ON projects(group_id);
    CREATE INDEX IF NOT EXISTS projects_pinned_idx ON projects(pinned);
    -- projects_sandbox_idx is created after ensureColumn (below), since the
    -- sandbox_id column may need to be added to a pre-existing projects table.

    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS worktrees_project_idx ON worktrees(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS worktrees_project_name_unique ON worktrees(project_id, name);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      worktree_id TEXT REFERENCES worktrees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      icon TEXT,
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
    CREATE INDEX IF NOT EXISTS tasks_project_worktree_idx ON tasks(project_id, worktree_id);
    CREATE INDEX IF NOT EXISTS tasks_worktree_idx ON tasks(worktree_id);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_archived_idx ON tasks(archived);

    CREATE TABLE IF NOT EXISTS terminal_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      chunk TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS terminal_logs_task_idx ON terminal_logs(task_id);

    CREATE TABLE IF NOT EXISTS task_diagrams (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT,
      source TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'mermaid',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_diagrams_project_idx ON task_diagrams(project_id);
    CREATE INDEX IF NOT EXISTS task_diagrams_task_idx ON task_diagrams(task_id);

    CREATE TABLE IF NOT EXISTS user_terminals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      worktree_id TEXT REFERENCES worktrees(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cwd TEXT,
      start_command TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_terminals_project_idx ON user_terminals(project_id);
    CREATE INDEX IF NOT EXISTS user_terminals_project_worktree_idx ON user_terminals(project_id, worktree_id);
    CREATE INDEX IF NOT EXISTS user_terminals_worktree_idx ON user_terminals(worktree_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
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

  // Multi-sandbox scope column. Idempotent + tolerant of a pre-existing column
  // (a schema-divergent build may already define `sandbox_id`), so the index is
  // created only after the column is guaranteed present. See docs/multi-sandbox-plan.md.
  ensureColumn(sqlite, "projects", "sandbox_id", "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE");
  sqlite.exec(`CREATE INDEX IF NOT EXISTS projects_sandbox_idx ON projects(sandbox_id);`);

  // Keep pre-release sandbox tables moving forward even if they were created by
  // an earlier branch before all remote/local config columns existed.
  ensureColumn(sqlite, "sandboxes", "name", "TEXT NOT NULL DEFAULT 'Sandbox'");
  ensureColumn(sqlite, "sandboxes", "kind", "TEXT NOT NULL DEFAULT 'local-docker'");
  ensureColumn(sqlite, "sandboxes", "color", "TEXT");
  ensureColumn(sqlite, "sandboxes", "image_tag", "TEXT");
  ensureColumn(sqlite, "sandboxes", "dockerfile_path", "TEXT");
  ensureColumn(sqlite, "sandboxes", "build_args", "TEXT");
  ensureColumn(sqlite, "sandboxes", "git_auth_mode", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(sqlite, "sandboxes", "declared_ports", "TEXT");
  ensureColumn(sqlite, "sandboxes", "env", "TEXT");
  ensureColumn(sqlite, "sandboxes", "host_agent_port", "INTEGER");
  ensureColumn(sqlite, "sandboxes", "port_map", "TEXT");
  ensureColumn(sqlite, "sandboxes", "pairing_token", "TEXT");
  ensureColumn(sqlite, "sandboxes", "remote_config", "TEXT");
  ensureColumn(sqlite, "sandboxes", "created_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "sandboxes", "updated_at", "INTEGER NOT NULL DEFAULT 0");

  // Legacy builds briefly modeled "shell" as a task agent even though shell
  // terminals are not persisted tasks. Normalize stale rows before the narrowed
  // TaskAgent union reaches UI code that indexes AGENT_REGISTRY.
  sqlite.exec(`
    UPDATE tasks SET agent = 'claude-code' WHERE agent = 'shell';
    UPDATE projects SET saved_agent = NULL WHERE saved_agent = 'shell';
  `);
}

export { schema };
