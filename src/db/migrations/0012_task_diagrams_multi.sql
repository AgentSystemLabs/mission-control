-- Allow multiple diagrams per task session (append on each skill POST).
CREATE TABLE task_diagrams_new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  source TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'mermaid',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO task_diagrams_new (id, task_id, project_id, title, source, format, created_at, updated_at)
SELECT id, task_id, project_id, title, source, format, updated_at, updated_at
FROM task_diagrams;

DROP TABLE task_diagrams;
ALTER TABLE task_diagrams_new RENAME TO task_diagrams;

CREATE INDEX task_diagrams_project_idx ON task_diagrams(project_id);
CREATE INDEX task_diagrams_task_idx ON task_diagrams(task_id);
