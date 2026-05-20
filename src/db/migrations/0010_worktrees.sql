ALTER TABLE projects ADD COLUMN worktree_setup_command TEXT;

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX worktrees_project_idx ON worktrees(project_id);
CREATE UNIQUE INDEX worktrees_project_name_unique ON worktrees(project_id, name);

ALTER TABLE tasks ADD COLUMN worktree_id TEXT REFERENCES worktrees(id) ON DELETE CASCADE;
ALTER TABLE user_terminals ADD COLUMN worktree_id TEXT REFERENCES worktrees(id) ON DELETE CASCADE;

CREATE INDEX tasks_project_worktree_idx ON tasks(project_id, worktree_id);
CREATE INDEX user_terminals_project_worktree_idx ON user_terminals(project_id, worktree_id);
CREATE INDEX tasks_worktree_idx ON tasks(worktree_id);
CREATE INDEX user_terminals_worktree_idx ON user_terminals(worktree_id);
