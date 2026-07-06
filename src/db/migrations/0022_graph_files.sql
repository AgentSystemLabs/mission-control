-- Per-file stat + content-hash index for the code graph's incremental builds.
-- Replaces the fileHashes blob inside the code_graph_state app_settings row
-- (which was rewritten wholesale — ~hundreds of KB — on every incremental
-- pass). The (size, mtime_ms) pair is a read fastpath: when both match, the
-- stored hash is trusted and the file is never opened.
CREATE TABLE IF NOT EXISTS graph_files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);
