ALTER TABLE projects ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'local';
ALTER TABLE projects ADD COLUMN owner_user_id TEXT;
ALTER TABLE projects ADD COLUMN sandbox_id TEXT;
ALTER TABLE projects ADD COLUMN workspace_path TEXT;
ALTER TABLE projects ADD COLUMN repo_url TEXT;
ALTER TABLE projects ADD COLUMN sandbox_state TEXT;

CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_sandbox_unique ON projects(sandbox_id);
