-- Persist the latest diagram per task so session cards keep the diagram button
-- after app restart. One row per task; replaced on each diagram skill submit.
CREATE TABLE task_diagrams (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  source TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'mermaid',
  updated_at INTEGER NOT NULL
);

CREATE INDEX task_diagrams_project_idx ON task_diagrams(project_id);
