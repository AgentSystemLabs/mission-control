-- Recall: project-level memory. Curated, typed facts about a project, assembled
-- into a Session Brief fed to new agent sessions. Cascades away with its
-- project (and nulls source_task_id when the originating task is deleted).
CREATE TABLE project_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL DEFAULT 'local',
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

CREATE INDEX project_memory_project_idx ON project_memory(project_id);
CREATE INDEX project_memory_project_scope_idx ON project_memory(project_id, scope_id);
CREATE INDEX project_memory_type_idx ON project_memory(type);
CREATE INDEX project_memory_status_idx ON project_memory(status);
CREATE INDEX project_memory_pinned_idx ON project_memory(pinned);
