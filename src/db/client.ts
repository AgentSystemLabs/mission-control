import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as schema from "./schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS } from "~/shared/domain";
import { serverEnv } from "~/shared/env";

const migrationFiles = import.meta.glob("./migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function resolveUserDataDir(): string {
  const override = serverEnv().MC_USER_DATA_DIR;
  if (override) return override;
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
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _db = drizzle(_sqlite, { schema });
  const freshBootstrap = !tableExists(_sqlite, "projects");
  if (freshBootstrap) {
    ensureSchema(_sqlite, { createFreshUniqueIndexes: true });
    runMigrations(_sqlite, { markAllAppliedOnly: true });
  } else {
    runMigrations(_sqlite);
    ensureSchema(_sqlite);
  }
  // PTYs are owned by the Electron process and are not restored across app
  // restarts. Any task left as running after a restart is stale.
  _sqlite
    .prepare("UPDATE tasks SET status = 'disconnected', updated_at = ? WHERE status = 'running'")
    .run(Date.now());
  // Launch-spawned user terminals are session-only: their PTY died with the
  // previous app process, so the persisted row would respawn the command on
  // next visit and look like the run "survived" the restart. Drop them.
  // Inline equivalent of services/user-terminals.purgeLaunchSpawnedTerminals().
  // The service helper exists for explicit callers; we don't import it here
  // because services already depend on getDb(), and that import cycle would
  // trip the lazy DB init on module load.
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
    if (reconcileKnownMigration(sqlite, name)) {
      sqlite
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(name, Date.now());
      applied.add(name);
      continue;
    }
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

function reconcileKnownMigration(sqlite: Database.Database, name: string): boolean {
  switch (name) {
    case "0002_project_image.sql":
      return reconcileColumns(sqlite, [
        ["projects", "image_path", "image_path TEXT"],
      ]);
    case "0003_launch_commands.sql":
      return reconcileColumns(sqlite, [
        ["projects", "launch_commands", "launch_commands TEXT"],
        ["user_terminals", "start_command", "start_command TEXT"],
      ]);
    case "0004_remember_agent_settings.sql":
      return reconcileColumns(sqlite, [
        [
          "projects",
          "remember_agent_settings",
          "remember_agent_settings INTEGER NOT NULL DEFAULT 0",
        ],
        ["projects", "saved_agent", "saved_agent TEXT"],
        [
          "projects",
          "saved_skip_permissions",
          "saved_skip_permissions INTEGER NOT NULL DEFAULT 0",
        ],
      ]);
    case "0005_claude_session_persistence.sql":
      return reconcileColumns(
        sqlite,
        [
          ["tasks", "claude_session_id", "claude_session_id TEXT"],
          [
            "tasks",
            "claude_skip_permissions",
            "claude_skip_permissions INTEGER NOT NULL DEFAULT 0",
          ],
        ],
        () => {
          sqlite.exec(`
            DELETE FROM tasks
            WHERE agent = 'claude-code' AND claude_session_id IS NULL;

            UPDATE tasks
            SET status = 'disconnected', updated_at = strftime('%s','now') * 1000
            WHERE agent = 'claude-code' AND status IN ('running', 'needs-input', 'ready');
          `);
          if (tableExists(sqlite, "token_usage_daily_rollup")) {
            backfillTokenUsageDailyRollup(sqlite);
          }
        },
        { force: tableExists(sqlite, "token_usage_daily_rollup") }
      );
    case "0006_project_launch_url.sql":
      return reconcileColumns(sqlite, [
        ["projects", "launch_url", "launch_url TEXT"],
      ]);
    case "0007_claude_bare_session.sql":
      return reconcileColumns(sqlite, [
        [
          "tasks",
          "claude_bare_session",
          "claude_bare_session INTEGER NOT NULL DEFAULT 0",
        ],
        [
          "projects",
          "saved_bare_session",
          "saved_bare_session INTEGER NOT NULL DEFAULT 0",
        ],
      ]);
    case "0008_token_usage.sql":
      if (!tableExists(sqlite, "token_usage") && !tableExists(sqlite, "token_usage_session_offsets")) {
        return false;
      }
      sqlite.exec(`
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
      return true;
    case "0011_projects_github_url.sql":
      return reconcileColumns(sqlite, [
        ["projects", "github_url", "github_url TEXT"],
      ]);
    case "0014_token_usage_daily_rollup.sql":
      if (!tableExists(sqlite, "token_usage_daily_rollup")) return false;
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS token_usage_daily_rollup_day_idx
          ON token_usage_daily_rollup (day);
      `);
      backfillTokenUsageDailyRollup(sqlite);
      return true;
    case "0015_cloud_runtime_projects.sql":
      return reconcileColumns(
        sqlite,
        [
          ["projects", "runtime_kind", "runtime_kind TEXT NOT NULL DEFAULT 'local'"],
          ["projects", "owner_user_id", "owner_user_id TEXT"],
          ["projects", "sandbox_id", "sandbox_id TEXT"],
          ["projects", "workspace_path", "workspace_path TEXT"],
          ["projects", "repo_url", "repo_url TEXT"],
          ["projects", "sandbox_state", "sandbox_state TEXT"],
        ],
        () => {
          sqlite.exec(`
            CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_user_id);
            CREATE UNIQUE INDEX IF NOT EXISTS projects_sandbox_unique ON projects(sandbox_id);
          `);
        }
      );
    case "0016_project_image_data_url.sql":
      return reconcileColumns(sqlite, [
        ["projects", "image_data_url", "image_data_url TEXT"],
      ]);
    default:
      return false;
  }
}

function reconcileColumns(
  sqlite: Database.Database,
  columns: Array<[table: string, column: string, definition: string]>,
  after?: () => void,
  opts: { force?: boolean } = {}
): boolean {
  const hasAnyColumn =
    opts.force || columns.some(([table, column]) => columnExists(sqlite, table, column));
  if (!hasAnyColumn) return false;

  for (const [table, column, definition] of columns) {
    if (columnExists(sqlite, table, column)) continue;
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
  }
  after?.();
  return true;
}

function backfillTokenUsageDailyRollup(sqlite: Database.Database) {
  if (!tableExists(sqlite, "token_usage")) return;
  sqlite.exec(`
    DELETE FROM token_usage_daily_rollup;
    INSERT INTO token_usage_daily_rollup (
      day, project_id, input_tokens, output_tokens,
      cache_creation_tokens, cache_read_tokens, request_count
    )
    SELECT
      strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
      project_id,
      COALESCE(SUM(input_tokens), 0),
      COALESCE(SUM(output_tokens), 0),
      COALESCE(SUM(cache_creation_tokens), 0),
      COALESCE(SUM(cache_read_tokens), 0),
      COUNT(*)
    FROM token_usage
    GROUP BY day, project_id;
  `);
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return !!row;
}

function columnExists(sqlite: Database.Database, table: string, column: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
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
function ensureSchema(
  sqlite: Database.Database,
  opts: { createFreshUniqueIndexes?: boolean } = {},
) {
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
      image_data_url TEXT,
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      branch TEXT NOT NULL DEFAULT '${DEFAULT_BRANCH}',
      launch_commands TEXT,
      launch_url TEXT,
      runtime_kind TEXT NOT NULL DEFAULT 'local',
      owner_user_id TEXT,
      sandbox_id TEXT,
      workspace_path TEXT,
      repo_url TEXT,
      sandbox_state TEXT,
      remember_agent_settings INTEGER NOT NULL DEFAULT 0,
      saved_agent TEXT,
      saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
      saved_bare_session INTEGER NOT NULL DEFAULT 0,
      github_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_group_idx ON projects(group_id);
    CREATE INDEX IF NOT EXISTS projects_pinned_idx ON projects(pinned);
    CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS projects_sandbox_unique ON projects(sandbox_id);

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
    CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks(project_id, status);

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
    CREATE INDEX IF NOT EXISTS token_usage_task_ts_idx ON token_usage(task_id, ts);
    CREATE INDEX IF NOT EXISTS token_usage_project_ts_idx ON token_usage(project_id, ts);

    CREATE TABLE IF NOT EXISTS token_usage_session_offsets (
      claude_session_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage_daily_rollup (
      day TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, project_id)
    );
    CREATE INDEX IF NOT EXISTS token_usage_daily_rollup_day_idx ON token_usage_daily_rollup (day);
    ${
      opts.createFreshUniqueIndexes
        ? `
    CREATE UNIQUE INDEX IF NOT EXISTS projects_path_unique ON projects(path);
    CREATE UNIQUE INDEX IF NOT EXISTS groups_name_unique ON groups(name);
    CREATE UNIQUE INDEX IF NOT EXISTS user_terminals_project_name_unique ON user_terminals(project_id, name);
    `
        : ""
    }
  `);
}

export { schema };
