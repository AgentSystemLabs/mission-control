-- Recall Code Graph: the structural map of a project's source. graph_nodes are
-- symbols (one `file` node per source file plus its declarations); graph_edges
-- connect them (imports/calls/defines). Both cascade away with the project.
-- Rebuilt by the indexer. See recall-phase4a-code-graph.md.
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL DEFAULT 0,
  end_line INTEGER NOT NULL DEFAULT 0,
  exported INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  language TEXT NOT NULL,
  degree INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX graph_nodes_project_idx ON graph_nodes(project_id);
CREATE INDEX graph_nodes_project_kind_idx ON graph_nodes(project_id, kind);
CREATE INDEX graph_nodes_project_name_idx ON graph_nodes(project_id, name);
CREATE INDEX graph_nodes_project_file_idx ON graph_nodes(project_id, file_path);
CREATE INDEX graph_nodes_project_degree_idx ON graph_nodes(project_id, degree);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  src_id TEXT NOT NULL,
  dst_id TEXT,
  dst_name TEXT,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'extracted',
  created_at INTEGER NOT NULL
);

CREATE INDEX graph_edges_project_idx ON graph_edges(project_id);
CREATE INDEX graph_edges_src_idx ON graph_edges(src_id);
CREATE INDEX graph_edges_dst_idx ON graph_edges(dst_id);
CREATE INDEX graph_edges_project_kind_idx ON graph_edges(project_id, kind);
