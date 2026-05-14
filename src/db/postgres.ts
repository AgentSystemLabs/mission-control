import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./pg-schema";
import { serverEnv } from "~/shared/env";

let _client: postgres.Sql | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _schemaReady: Promise<void> | null = null;

export function getPostgresClient(): postgres.Sql {
  if (_client) return _client;
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required in cloud mode");
  _client = postgres(url, {
    max: 10,
    prepare: false,
  });
  return _client;
}

export function getPostgresDb() {
  if (_db) return _db;
  _db = drizzle(getPostgresClient(), { schema });
  return _db;
}

export async function ensurePostgresSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = getPostgresClient();
    await sql.unsafe(POSTGRES_BOOTSTRAP_SQL);
  })();
  return _schemaReady;
}

export async function closePostgresForTests(): Promise<void> {
  await _client?.end({ timeout: 1 });
  _client = null;
  _db = null;
  _schemaReady = null;
}

const POSTGRES_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  expires_at TIMESTAMP NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session"(user_id);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMP,
  refresh_token_expires_at TIMESTAMP,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS groups_owner_name_unique ON groups(owner_user_id, name);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  icon TEXT NOT NULL,
  icon_color TEXT NOT NULL,
  image_path TEXT,
  image_data_url TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  branch TEXT NOT NULL DEFAULT 'main',
  launch_commands TEXT,
  launch_url TEXT,
  runtime_kind TEXT NOT NULL DEFAULT 'local',
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  sandbox_id TEXT,
  workspace_path TEXT,
  repo_url TEXT,
  sandbox_state TEXT,
  remember_agent_settings BOOLEAN NOT NULL DEFAULT FALSE,
  saved_agent TEXT,
  saved_skip_permissions BOOLEAN NOT NULL DEFAULT FALSE,
  saved_bare_session BOOLEAN NOT NULL DEFAULT FALSE,
  github_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_group_idx ON projects(group_id);
CREATE INDEX IF NOT EXISTS projects_pinned_idx ON projects(pinned);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_path_unique ON projects(owner_user_id, path);
CREATE UNIQUE INDEX IF NOT EXISTS projects_sandbox_unique ON projects(sandbox_id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS image_data_url TEXT;

UPDATE projects
SET workspace_path = CASE
  WHEN EXISTS (
    SELECT 1
    FROM projects AS existing
    WHERE existing.id <> projects.id
      AND existing.owner_user_id = projects.owner_user_id
      AND COALESCE(existing.workspace_path, existing.path) = CASE
        WHEN projects.workspace_path = '/workspace' THEN 'workspace'
        ELSE 'workspace' || substring(projects.workspace_path from length('/workspace') + 1)
      END
  )
    THEN CASE
      WHEN workspace_path = '/workspace' THEN 'workspace'
      ELSE 'workspace' || substring(workspace_path from length('/workspace') + 1)
    END || '-' || id
  WHEN workspace_path = '/workspace' THEN 'workspace'
  ELSE 'workspace' || substring(workspace_path from length('/workspace') + 1)
END
WHERE runtime_kind <> 'local'
  AND (workspace_path = '/workspace' OR workspace_path LIKE '/workspace/%');

UPDATE projects
SET path = CASE
  WHEN EXISTS (
    SELECT 1
    FROM projects AS existing
    WHERE existing.id <> projects.id
      AND existing.owner_user_id = projects.owner_user_id
      AND existing.path = CASE
        WHEN projects.path = '/workspace' THEN 'workspace'
        ELSE 'workspace' || substring(projects.path from length('/workspace') + 1)
      END
  )
    THEN CASE
      WHEN path = '/workspace' THEN 'workspace'
      ELSE 'workspace' || substring(path from length('/workspace') + 1)
    END || '-' || id
  WHEN path = '/workspace' THEN 'workspace'
  ELSE 'workspace' || substring(path from length('/workspace') + 1)
END
WHERE runtime_kind <> 'local'
  AND (path = '/workspace' OR path LIKE '/workspace/%');

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  branch TEXT NOT NULL DEFAULT 'main',
  preview TEXT NOT NULL DEFAULT '',
  lines INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  claude_session_id TEXT,
  claude_skip_permissions BOOLEAN NOT NULL DEFAULT FALSE,
  claude_bare_session BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_archived_idx ON tasks(archived);
CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks(project_id, status);

CREATE TABLE IF NOT EXISTS terminal_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  chunk TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS terminal_logs_task_idx ON terminal_logs(task_id);

CREATE TABLE IF NOT EXISTS user_terminals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cwd TEXT,
  start_command TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_terminals_project_idx ON user_terminals(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_terminals_project_name_unique ON user_terminals(project_id, name);
ALTER TABLE user_terminals ADD COLUMN IF NOT EXISTS cwd TEXT;
ALTER TABLE user_terminals ADD COLUMN IF NOT EXISTS start_command TEXT;
ALTER TABLE user_terminals ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_terminals ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_terminals ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_settings (
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, key)
);
CREATE INDEX IF NOT EXISTS app_settings_owner_idx ON app_settings(owner_user_id);

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
  ts BIGINT NOT NULL
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
  updated_at BIGINT NOT NULL
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
CREATE INDEX IF NOT EXISTS token_usage_daily_rollup_day_idx ON token_usage_daily_rollup(day);
`;

export { schema };
