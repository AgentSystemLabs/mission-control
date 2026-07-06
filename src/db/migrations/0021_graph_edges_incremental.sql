-- Incremental-correct graph edges. `is_member` records whether a call edge came
-- from a member expression (`x.foo()`), which the re-resolution pass must honor
-- (member calls are never name-resolved across files). The partial index serves
-- the dangling-edge scans that re-attach detached edges after a re-index.
-- Existing rows lack `dst_name` on resolved edges; the indexer forces a one-time
-- full rebuild via GRAPH_INDEX_SCHEMA_VERSION instead of a data migration.
ALTER TABLE graph_edges ADD COLUMN is_member INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS graph_edges_dangling_idx
  ON graph_edges(project_id, kind, dst_name)
  WHERE dst_id IS NULL;
