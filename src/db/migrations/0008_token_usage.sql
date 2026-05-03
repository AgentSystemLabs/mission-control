-- Persist Claude session token usage so the /usage page doesn't have to scan
-- the full ~/.claude/projects/ JSONL tree on every open. We dedupe by the
-- per-line `uuid` from Claude's JSONL (UNIQUE) and remember the last byte
-- offset per session so re-ingest is incremental.
CREATE TABLE token_usage (
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

CREATE INDEX token_usage_task_idx ON token_usage(task_id);
CREATE INDEX token_usage_project_idx ON token_usage(project_id);
CREATE INDEX token_usage_ts_idx ON token_usage(ts);

CREATE TABLE token_usage_session_offsets (
  claude_session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
