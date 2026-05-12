-- Data integrity hardening: enforce uniqueness on identifiers that the
-- application has been treating as unique by convention.
--   * projects.path  — two project rows pointing at the same working dir
--                      race on git ops; also closes a TOCTOU around the
--                      Free-tier cap check.
--   * groups.name    — duplicate group names silently allowed before.
--   * (user_terminals.project_id, user_terminals.name) — duplicate terminal
--                      names within a project silently allowed before.
--
-- Dedupe any pre-existing duplicates first so the unique indexes can be
-- created. Local-only desktop DB, but safety is cheap.

-- Projects: keep the oldest row per path; cascade deletes drop dependent
-- tasks, terminal_logs, user_terminals, token_usage, and token_usage_session_offsets.
DELETE FROM projects
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY path ORDER BY created_at ASC, id ASC) AS rn
    FROM projects
  )
  WHERE rn = 1
);

-- Groups: rename collisions to "name (2)", "name (3)", ... in insertion order
-- so existing project.group_id references stay valid (we never delete groups
-- here; we only adjust the duplicate names).
UPDATE groups AS g
SET name = g.name || ' (' || (
  SELECT COUNT(*) FROM groups g2
  WHERE g2.name = g.name AND (g2.created_at < g.created_at OR (g2.created_at = g.created_at AND g2.id < g.id))
) + 1 || ')'
WHERE EXISTS (
  SELECT 1 FROM groups g2
  WHERE g2.name = g.name AND g2.id <> g.id
)
AND EXISTS (
  SELECT 1 FROM groups g2
  WHERE g2.name = g.name AND (g2.created_at < g.created_at OR (g2.created_at = g.created_at AND g2.id < g.id))
);

-- User terminals: keep the oldest row per (project_id, name).
DELETE FROM user_terminals
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY project_id, name ORDER BY created_at ASC, id ASC) AS rn
    FROM user_terminals
  )
  WHERE rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_path_unique ON projects(path);
CREATE UNIQUE INDEX IF NOT EXISTS groups_name_unique ON groups(name);
CREATE UNIQUE INDEX IF NOT EXISTS user_terminals_project_name_unique ON user_terminals(project_id, name);
