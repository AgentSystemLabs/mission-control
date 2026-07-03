-- Durable, searchable history of every prompt submitted to a session. One row
-- per submission (deduped in services/prompts.ts so the agent hook and the
-- terminal-capture fallback don't both persist the same send). Powers the
-- prompt-search palette. Cascades away with its task/project.
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worktree_id TEXT,
  scope_id TEXT NOT NULL DEFAULT 'local',
  claude_session_id TEXT,
  agent TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX prompts_task_idx ON prompts(task_id);
CREATE INDEX prompts_project_idx ON prompts(project_id);
CREATE INDEX prompts_ts_idx ON prompts(ts);
