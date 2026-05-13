-- Composite index for the common task list filter: tasks scoped to a project,
-- narrowed by status (active boards, archive views). The existing single-column
-- project and status indexes force the planner to pick one and filter the rest
-- in memory; this lets a single index range scan satisfy both predicates.
CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks (project_id, status);
