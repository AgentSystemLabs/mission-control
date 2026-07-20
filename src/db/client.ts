import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as schema from "./schema";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";
import { migrateMultiSandbox } from "./migrate-multi-sandbox";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS } from "~/shared/domain";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

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

// missioncontrol.db holds the API bearer token and every sandbox pairing token
// in cleartext. Created with default perms it is world-readable (~0644), so any
// other local user / backup / sync process can lift those secrets straight off
// disk. Tighten the directory to owner-only and the DB (plus its WAL/SHM
// sidecars) to 0600. Best-effort: on filesystems/platforms without POSIX modes
// (e.g. Windows) chmod is a harmless no-op.
export function restrictDbFilePermissions(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
    } catch {
      /* best effort */
    }
  }
}

export function getDb() {
  if (_db) return _db;
  const dir = resolveUserDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(dir, "missioncontrol.db");
  _sqlite = new Database(dbPath, {
    nativeBinding: resolveElectronBetterSqlite3NativeBinding(),
  });
  const journalMode = _sqlite.pragma("journal_mode = WAL", { simple: true });
  // WAL + NORMAL is the durable-enough, low-fsync combo SQLite recommends for
  // app databases: writers only fsync on checkpoint, not per commit, which cuts
  // disk churn on our frequent small writes. But NORMAL is only crash-safe in
  // WAL mode — if the WAL pragma failed and SQLite fell back to a rollback
  // journal (e.g. a filesystem that can't support WAL), NORMAL leaves a small
  // power-loss corruption window. So only lower synchronous when WAL actually
  // took; otherwise keep the default (FULL).
  if (journalMode === "wal") {
    _sqlite.pragma("synchronous = NORMAL");
  }
  // busy_timeout lets a blocked writer wait (up to 5s) for a concurrent
  // checkpoint/writer instead of throwing SQLITE_BUSY immediately.
  _sqlite.pragma("busy_timeout = 5000");
  restrictDbFilePermissions(dbPath);
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
  reconcileStaleSessionsOnBoot(_sqlite);
  // Launch-spawned user terminals are session-only: their PTY died with the
  // previous app process, so the persisted row would respawn the command on
  // next visit and look like the run "survived" the restart. Drop them.
  _sqlite.prepare("DELETE FROM user_terminals WHERE start_command IS NOT NULL").run();
  return _db;
}

/**
 * PTYs are owned by the Electron process and are not restored across app
 * restarts, so on every launch any task the app left mid-session has a dead PTY
 * now: one that was actively `running`, or one blocked waiting on the user
 * (`needs-input`). Left as-is, a `needs-input` row never transitions on its own
 * — its agent is gone — so it would linger forever, keep the project's "needs
 * input" dot lit, and hold the Mission Pet in its alert mood across restarts.
 * Reset both to `disconnected` (click-to-resume) so the stale state is cleared.
 *
 * `ready` is deliberately left alone: it means "created but never launched", so
 * there is no dead session to reconcile.
 */
export function reconcileStaleSessionsOnBoot(sqlite: Database.Database): void {
  sqlite
    .prepare(
      "UPDATE tasks SET status = 'disconnected', updated_at = ? WHERE status IN ('running', 'needs-input')"
    )
    .run(Date.now());
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

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function indexColumns(sqlite: Database.Database, indexName: string): string[] {
  return (
    sqlite.prepare(`PRAGMA index_info(${quoteIdent(indexName)})`).all() as {
      name: string;
    }[]
  ).map((c) => c.name);
}

const STALE_PROJECT_UNIQUE_COLUMNS = new Set(["path", "sandbox_id"]);

function uniqueProjectIndexesToRepair(sqlite: Database.Database): { name: string }[] {
  return (
    sqlite.prepare("PRAGMA index_list(projects)").all() as {
      name: string;
      unique: number;
    }[]
  ).filter((idx) => {
    const columns = indexColumns(sqlite, idx.name);
    return idx.unique === 1 && columns.length === 1 && STALE_PROJECT_UNIQUE_COLUMNS.has(columns[0]);
  });
}

type TableColumn = {
  name: string;
};

function splitSqlList(input: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

function staleProjectUniqueColumnPattern(): string {
  return [...STALE_PROJECT_UNIQUE_COLUMNS]
    .map((column) => `(?:"${column}"|\`${column}\`|\\[${column}\\]|${column})`)
    .join("|");
}

function isStaleUniqueColumnDef(definition: string): boolean {
  return new RegExp(`^(?:${staleProjectUniqueColumnPattern()})(?:\\s|$)`, "i").test(definition.trimStart());
}

function isStaleUniqueConstraint(definition: string): boolean {
  const withoutName = definition
    .trimStart()
    .replace(/^CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+/i, "");
  return new RegExp(`^UNIQUE\\s*\\(\\s*(?:${staleProjectUniqueColumnPattern()})\\s*\\)`, "i").test(withoutName);
}

function projectTableSqlWithoutStaleUniques(sqlite: Database.Database): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'projects'")
    .get() as { sql: string } | undefined;
  if (!row?.sql) throw new Error("Cannot repair projects schema: missing CREATE TABLE SQL");

  const open = row.sql.indexOf("(");
  const close = row.sql.lastIndexOf(")");
  if (open < 0 || close < open) throw new Error("Cannot repair projects schema: invalid CREATE TABLE SQL");

  const body = row.sql.slice(open + 1, close);
  const suffix = row.sql.slice(close + 1);
  const definitions = splitSqlList(body)
    .map((definition) =>
      isStaleUniqueColumnDef(definition)
        ? definition.replace(
            /\bUNIQUE\b(?:\s+ON\s+CONFLICT\s+(?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?/i,
            "",
          )
        : definition,
    )
    .filter((definition) => !isStaleUniqueConstraint(definition));

  return `CREATE TABLE projects_without_stale_uniques (${definitions.join(",")})${suffix}`;
}

function rebuildProjectsWithoutStaleUniques(
  sqlite: Database.Database,
  uniqueIndexNames: Set<string>,
): void {
  const existingColumns = sqlite.prepare("PRAGMA table_info(projects)").all() as TableColumn[];
  const copyColumns = existingColumns.map((column) => quoteIdent(column.name)).join(", ");
  const createReplacementTable = projectTableSqlWithoutStaleUniques(sqlite);
  const schemaEntries = (
    sqlite
      .prepare(
        "SELECT type, name, sql FROM sqlite_schema WHERE tbl_name = 'projects' AND sql IS NOT NULL AND type IN ('index', 'trigger')",
      )
      .all() as { type: string; name: string; sql: string }[]
  ).filter((entry) => !uniqueIndexNames.has(entry.name));
  const replaySchemaSql = schemaEntries.map((entry) => entry.sql).join(";\n");

  const foreignKeys = sqlite.pragma("foreign_keys", { simple: true }) as number;
  let inTransaction = false;
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    inTransaction = true;
    sqlite.exec(`
      DROP TABLE IF EXISTS projects_without_stale_uniques;
      ${createReplacementTable};
      INSERT INTO projects_without_stale_uniques (${copyColumns})
        SELECT ${copyColumns} FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_without_stale_uniques RENAME TO projects;
      ${replaySchemaSql ? `${replaySchemaSql};` : ""}
    `);
    const violations = sqlite.prepare("PRAGMA foreign_key_check").all();
    if (violations.length) {
      throw new Error("Project schema repair failed foreign key validation");
    }
    sqlite.exec("COMMIT");
    inTransaction = false;
  } catch (error) {
    if (inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}

export function ensureProjectSandboxIndex(sqlite: Database.Database): void {
  const uniqueIndexes = uniqueProjectIndexesToRepair(sqlite);
  const uniqueIndexNames = new Set(uniqueIndexes.map((idx) => idx.name));
  if (uniqueIndexes.some((idx) => idx.name.startsWith("sqlite_autoindex_"))) {
    rebuildProjectsWithoutStaleUniques(sqlite, uniqueIndexNames);
  } else {
    for (const idx of uniqueIndexes) {
      sqlite.exec(`DROP INDEX IF EXISTS ${quoteIdent(idx.name)}`);
    }
  }

  sqlite.exec(`CREATE INDEX IF NOT EXISTS projects_group_idx ON projects(group_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS projects_pinned_idx ON projects(pinned);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS projects_sandbox_idx ON projects(sandbox_id);`);
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
      sort_order INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sandboxes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'remote-vm',
      color TEXT,
      image_tag TEXT,
      dockerfile_path TEXT,
      build_args TEXT,
      git_auth_mode TEXT NOT NULL DEFAULT 'none',
      copy_agent_creds INTEGER NOT NULL DEFAULT 0,
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
      custom_scripts TEXT,
      launch_url TEXT,
      worktree_setup_command TEXT,
      remember_agent_settings INTEGER NOT NULL DEFAULT 0,
      saved_agent TEXT,
      saved_skip_permissions INTEGER NOT NULL DEFAULT 0,
      saved_bare_session INTEGER NOT NULL DEFAULT 0,
      default_grid_view INTEGER NOT NULL DEFAULT 0,
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
      scope_id TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}',
      title TEXT NOT NULL,
      title_manually_set INTEGER NOT NULL DEFAULT 0,
      icon TEXT,
      agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '${DEFAULT_TASK_STATUS}',
      branch TEXT NOT NULL DEFAULT '${DEFAULT_BRANCH}',
      preview TEXT NOT NULL DEFAULT '',
      lines INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS tasks_pinned_idx ON tasks(pinned);
    -- listProjects() aggregates non-archived task counts with
    -- WHERE archived = 0 GROUP BY project_id, status. This partial covering
    -- index lets SQLite satisfy that GROUP BY by scanning the index in
    -- (project_id, status) order, avoiding a temp B-tree that spilled the 2MB
    -- page cache to disk at extreme scale (~2.6s -> ~25ms at 750k tasks). It's
    -- scoped to archived = 0 to stay small and match the query's predicate.
    CREATE INDEX IF NOT EXISTS tasks_active_project_status_idx ON tasks(project_id, status) WHERE archived = 0;

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
      scope_id TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}',
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

    -- Project-less "home" terminals (dashboard). Separate table so user_terminals
    -- never needs a destructive rebuild to relax its NOT NULL project_id FK.
    -- scope_id scopes each terminal to the sandbox (or "local") it runs on.
    CREATE TABLE IF NOT EXISTS home_terminals (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}',
      name TEXT NOT NULL,
      cwd TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS home_terminals_scope_idx ON home_terminals(scope_id);

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
    -- Covering indexes so a raw-table aggregate (backfill, or any fallback read)
    -- can sum straight from the index without touching the heap. The rollup
    -- below is the primary read path; these keep the raw path from cliffing.
    CREATE INDEX IF NOT EXISTS token_usage_project_cover_idx
      ON token_usage(project_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens);
    CREATE INDEX IF NOT EXISTS token_usage_ts_cover_idx
      ON token_usage(ts, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens);
    CREATE INDEX IF NOT EXISTS token_usage_task_ts_cover_idx
      ON token_usage(task_id, ts, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens);

    -- Pre-aggregated token usage per (project, task, local day). Every summary
    -- read (totals, per-project, per-session, per-day) sums this instead of
    -- scanning all of token_usage, turning multi-second aggregates at ~1M rows
    -- into sub-millisecond ones. Kept in lockstep with token_usage by the ingest
    -- transaction (only newly-inserted rows are folded in) and by ON DELETE
    -- CASCADE, which drops rollup rows when a task/project is removed just as it
    -- drops the raw rows — so the rollup always equals the raw aggregate.
    CREATE TABLE IF NOT EXISTS token_usage_rollup (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      last_ts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, task_id, day)
    );
    CREATE INDEX IF NOT EXISTS token_usage_rollup_project_idx ON token_usage_rollup(project_id);
    CREATE INDEX IF NOT EXISTS token_usage_rollup_task_idx ON token_usage_rollup(task_id);
    CREATE INDEX IF NOT EXISTS token_usage_rollup_day_idx ON token_usage_rollup(day);

    CREATE TABLE IF NOT EXISTS token_usage_session_offsets (
      claude_session_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      worktree_id TEXT,
      scope_id TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}',
      claude_session_id TEXT,
      agent TEXT NOT NULL,
      text TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prompts_task_idx ON prompts(task_id);
    CREATE INDEX IF NOT EXISTS prompts_project_idx ON prompts(project_id);
    CREATE INDEX IF NOT EXISTS prompts_ts_idx ON prompts(ts);

    CREATE TABLE IF NOT EXISTS project_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tags TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      confidence TEXT NOT NULL DEFAULT 'inferred',
      source TEXT NOT NULL DEFAULT 'manual',
      source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      superseded_by_id TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_verified_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_memory_project_idx ON project_memory(project_id);
    CREATE INDEX IF NOT EXISTS project_memory_project_scope_idx ON project_memory(project_id, scope_id);
    CREATE INDEX IF NOT EXISTS project_memory_type_idx ON project_memory(type);
    CREATE INDEX IF NOT EXISTS project_memory_status_idx ON project_memory(status);
    CREATE INDEX IF NOT EXISTS project_memory_pinned_idx ON project_memory(pinned);

    CREATE TABLE IF NOT EXISTS scratch_pads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scratch_pads_project_idx ON scratch_pads(project_id);
    CREATE INDEX IF NOT EXISTS scratch_pads_project_updated_idx ON scratch_pads(project_id, updated_at);

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL DEFAULT 0,
      end_line INTEGER NOT NULL DEFAULT 0,
      exported INTEGER NOT NULL DEFAULT 0,
      signature TEXT,
      language TEXT NOT NULL,
      degree INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS graph_nodes_project_idx ON graph_nodes(project_id);
    CREATE INDEX IF NOT EXISTS graph_nodes_project_kind_idx ON graph_nodes(project_id, kind);
    CREATE INDEX IF NOT EXISTS graph_nodes_project_name_idx ON graph_nodes(project_id, name);
    CREATE INDEX IF NOT EXISTS graph_nodes_project_file_idx ON graph_nodes(project_id, file_path);
    CREATE INDEX IF NOT EXISTS graph_nodes_project_degree_idx ON graph_nodes(project_id, degree);

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      src_id TEXT NOT NULL,
      dst_id TEXT,
      dst_name TEXT,
      kind TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'extracted',
      is_member INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS graph_edges_project_idx ON graph_edges(project_id);
    CREATE INDEX IF NOT EXISTS graph_edges_src_idx ON graph_edges(src_id);
    CREATE INDEX IF NOT EXISTS graph_edges_dst_idx ON graph_edges(dst_id);
    CREATE INDEX IF NOT EXISTS graph_edges_project_kind_idx ON graph_edges(project_id, kind);

    CREATE TABLE IF NOT EXISTS graph_files (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (project_id, path)
    );
  `);

  // Multi-sandbox scope column. Idempotent + tolerant of a pre-existing column
  // (a schema-divergent build may already define `sandbox_id`), so the index is
  // created only after the column is guaranteed present. See docs/multi-sandbox-plan.md.
  ensureColumn(sqlite, "projects", "sandbox_id", "TEXT REFERENCES sandboxes(id) ON DELETE CASCADE");
  ensureProjectSandboxIndex(sqlite);

  // Manual group ordering. Legacy rows keep NULL until the user reorders (they
  // sort last by created_at meanwhile) — see groups.repo findAllGroups.
  ensureColumn(sqlite, "groups", "sort_order", "INTEGER");

  // Per-project custom scripts (JSON array of {id,name,command}). Tolerate a
  // pre-existing column: a fresh bootstrap marks migrations applied-only, so
  // 0014 never runs on a brand-new DB — the inline DDL above covers that, and
  // this guard covers any schema-divergent build. See 0014_custom_scripts.sql.
  ensureColumn(sqlite, "projects", "custom_scripts", "TEXT");

  // Keep pre-release sandbox tables moving forward even if they were created by
  // an earlier branch before all remote/local config columns existed.
  ensureColumn(sqlite, "sandboxes", "name", "TEXT NOT NULL DEFAULT 'Sandbox'");
  ensureColumn(sqlite, "sandboxes", "kind", "TEXT NOT NULL DEFAULT 'remote-vm'");
  ensureColumn(sqlite, "sandboxes", "color", "TEXT");
  ensureColumn(sqlite, "sandboxes", "image_tag", "TEXT");
  ensureColumn(sqlite, "sandboxes", "dockerfile_path", "TEXT");
  ensureColumn(sqlite, "sandboxes", "build_args", "TEXT");
  ensureColumn(sqlite, "sandboxes", "git_auth_mode", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(sqlite, "sandboxes", "copy_agent_creds", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "sandboxes", "declared_ports", "TEXT");
  ensureColumn(sqlite, "sandboxes", "env", "TEXT");
  ensureColumn(sqlite, "sandboxes", "host_agent_port", "INTEGER");
  ensureColumn(sqlite, "sandboxes", "port_map", "TEXT");
  ensureColumn(sqlite, "sandboxes", "pairing_token", "TEXT");
  ensureColumn(sqlite, "sandboxes", "remote_config", "TEXT");
  ensureColumn(sqlite, "sandboxes", "created_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "sandboxes", "updated_at", "INTEGER NOT NULL DEFAULT 0");

  // Terminal/session rows gained per-runtime scope after their first ship;
  // tolerate pre-existing tables created without it.
  ensureColumn(sqlite, "tasks", "scope_id", `TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}'`);
  ensureColumn(sqlite, "tasks", "title_manually_set", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "tasks", "pinned", "INTEGER NOT NULL DEFAULT 0");
  sqlite.exec("CREATE INDEX IF NOT EXISTS tasks_project_worktree_scope_idx ON tasks(project_id, worktree_id, scope_id);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS tasks_scope_idx ON tasks(scope_id);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS tasks_pinned_idx ON tasks(pinned);");
  // findTasksByProjectId filters (project_id, scope_id) and orders by created_at
  // DESC. Without a composite covering that shape SQLite picks a single-column
  // index and sorts separately; this lets it satisfy the filter + order in one
  // index scan.
  sqlite.exec("CREATE INDEX IF NOT EXISTS tasks_project_scope_created_idx ON tasks(project_id, scope_id, created_at);");
  ensureColumn(sqlite, "user_terminals", "scope_id", `TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}'`);
  sqlite.exec("CREATE INDEX IF NOT EXISTS user_terminals_project_worktree_scope_idx ON user_terminals(project_id, worktree_id, scope_id);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS user_terminals_scope_idx ON user_terminals(scope_id);");
  ensureColumn(sqlite, "home_terminals", "scope_id", `TEXT NOT NULL DEFAULT '${LOCAL_SCOPE_ID}'`);
  sqlite.exec("CREATE INDEX IF NOT EXISTS home_terminals_scope_idx ON home_terminals(scope_id);");

  // Incremental-correct graph edges: `is_member` + the dangling-edge partial
  // index arrived after graph_edges first shipped (see 0021). ensureColumn
  // covers schema-divergent builds; the index needs the column to exist first.
  ensureColumn(sqlite, "graph_edges", "is_member", "INTEGER NOT NULL DEFAULT 0");
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS graph_edges_dangling_idx
      ON graph_edges(project_id, kind, dst_name)
      WHERE dst_id IS NULL;
  `);

  // Legacy builds briefly modeled "shell" as a task agent even though shell
  // terminals are not persisted tasks. Normalize stale rows before the narrowed
  // TaskAgent union reaches UI code that indexes AGENT_REGISTRY.
  sqlite.exec(`
    UPDATE tasks SET agent = 'claude-code' WHERE agent = 'shell';
    UPDATE projects SET saved_agent = NULL WHERE saved_agent = 'shell';
  `);

  // Full-text search index over project_memory. Runtime-created (not a migration)
  // so a SQLite build without FTS5 degrades to LIKE search instead of failing to
  // boot. Idempotent + backfills existing rows on the upgrade path. See
  // 0020_project_memory_fts.sql.
  ensureMemoryFts(sqlite);

  // One-time upgrade-path fill of the token-usage rollup from existing raw rows.
  // Fresh DBs have no token_usage yet (no-op); the ingest transaction keeps it
  // current from here on.
  backfillTokenUsageRollup(sqlite);
}

/**
 * Populate token_usage_rollup from token_usage once, when the rollup is empty
 * but raw usage rows already exist (i.e. a DB created before the rollup shipped).
 * Idempotent: a no-op on fresh DBs and on every subsequent boot. Transactional so
 * a crash mid-fill leaves the rollup empty and simply retries next boot. Uses the
 * same local-day expression the ingest upsert and read queries use, so the
 * aggregate matches the raw table exactly.
 */
export function backfillTokenUsageRollup(sqlite: Database.Database): void {
  const rollupCount = (
    sqlite.prepare("SELECT count(*) AS n FROM token_usage_rollup").get() as { n: number }
  ).n;
  if (rollupCount > 0) return;
  const rawCount = (
    sqlite.prepare("SELECT count(*) AS n FROM token_usage").get() as { n: number }
  ).n;
  if (rawCount === 0) return;
  sqlite
    .transaction(() => {
      sqlite.exec(`
        INSERT INTO token_usage_rollup (
          project_id, task_id, day,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, last_ts
        )
        SELECT
          project_id,
          task_id,
          strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
          SUM(input_tokens),
          SUM(output_tokens),
          SUM(cache_creation_tokens),
          SUM(cache_read_tokens),
          MAX(ts)
        FROM token_usage
        GROUP BY project_id, task_id, day;
      `);
    })();
}

/**
 * Create the FTS5 full-text index over `project_memory` (title/body/tags) plus
 * the triggers that keep it in sync with every insert/update/delete, and backfill
 * it once from existing rows. Fail-soft: returns false (and the search layer
 * falls back to LIKE) if this SQLite build lacks FTS5, so it never breaks boot.
 */
export function ensureMemoryFts(sqlite: Database.Database): boolean {
  try {
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_fts USING fts5(
        title, body, tags,
        content='project_memory',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS project_memory_fts_ai
      AFTER INSERT ON project_memory BEGIN
        INSERT INTO project_memory_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, COALESCE(new.tags, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS project_memory_fts_ad
      AFTER DELETE ON project_memory BEGIN
        INSERT INTO project_memory_fts(project_memory_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, COALESCE(old.tags, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS project_memory_fts_au
      AFTER UPDATE ON project_memory BEGIN
        INSERT INTO project_memory_fts(project_memory_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, COALESCE(old.tags, ''));
        INSERT INTO project_memory_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, COALESCE(new.tags, ''));
      END;
    `);

    // One-time backfill (upgrade path): populate the index if it's empty while
    // memories already exist. Fresh DBs have no rows yet, so this is a no-op there.
    const ftsCount = (
      sqlite.prepare("SELECT count(*) AS n FROM project_memory_fts").get() as { n: number }
    ).n;
    if (ftsCount === 0) {
      const memCount = (
        sqlite.prepare("SELECT count(*) AS n FROM project_memory").get() as { n: number }
      ).n;
      if (memCount > 0) {
        sqlite.exec(`
          INSERT INTO project_memory_fts(rowid, title, body, tags)
          SELECT rowid, title, body, COALESCE(tags, '') FROM project_memory;
        `);
      }
    }

    // Detect and repair a corrupt/desynced FTS index every boot. This MUST go
    // through a call that never throws: a corruption error raised here would
    // otherwise be swallowed by the outer catch and misread as "no FTS5 in this
    // build", skipping the repair entirely.
    repairMemoryFtsIfCorrupt(sqlite);
    return true;
  } catch {
    // No FTS5 in this build — leave searchMemory on its LIKE path.
    return false;
  }
}

/**
 * Verify the `project_memory` FTS5 index is consistent and rebuild it from the
 * content table if it is not.
 *
 * A corrupt or content-desynced FTS5 index throws SQLITE_CORRUPT ("database
 * disk image is malformed") the moment a delete/update trigger writes to it.
 * Deleting a project cascades into `project_memory`, whose AFTER DELETE trigger
 * writes to this index — so a corrupt index silently blocks *project deletion*
 * and every memory edit, not just search, surfacing only as a generic 500.
 * Ordinary `PRAGMA integrity_check` does not inspect FTS5 shadow tables; the
 * FTS5 `('integrity-check', 1)` command — which also checks the index against
 * the content table — is the only reliable detector.
 *
 * Fail-soft: never throws. Returns what it did so callers and tests can assert.
 */
export function repairMemoryFtsIfCorrupt(
  sqlite: Database.Database,
): "ok" | "rebuilt" | "unavailable" {
  try {
    sqlite
      .prepare("INSERT INTO project_memory_fts(project_memory_fts, rank) VALUES ('integrity-check', 1)")
      .run();
    return "ok";
  } catch {
    // Index is corrupt/desynced (or FTS5/the table is unavailable). Rebuild it
    // from the content table; if even that fails, leave search on its LIKE
    // fallback rather than breaking boot.
    try {
      sqlite
        .prepare("INSERT INTO project_memory_fts(project_memory_fts) VALUES ('rebuild')")
        .run();
      console.warn("[db] project_memory FTS index was corrupt or out of sync; rebuilt it");
      return "rebuilt";
    } catch {
      return "unavailable";
    }
  }
}

export { schema };
