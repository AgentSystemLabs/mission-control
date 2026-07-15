-- Per-project default layout chosen at create time: 1 = grid (all sessions
-- tiled), 0 = list (sessions stacked in a column). The in-session grid/list
-- toggle still overrides this at runtime; this only decides how the project
-- first opens.
ALTER TABLE projects ADD COLUMN default_grid_view INTEGER NOT NULL DEFAULT 0;
