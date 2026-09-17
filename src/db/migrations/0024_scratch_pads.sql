-- Scratch pads: per-project temporary text buffers, opened from the top bar.
-- A lightweight place to paste text while working; cascades away with the
-- project. Title is derived client-side from the first line of content.
CREATE TABLE scratch_pads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX scratch_pads_project_idx ON scratch_pads(project_id);
CREATE INDEX scratch_pads_project_updated_idx ON scratch_pads(project_id, updated_at);
