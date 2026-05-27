ALTER TABLE projects ADD COLUMN pinned_order INTEGER;

UPDATE projects SET pinned_order = NULL WHERE pinned = 0;

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC) - 1 AS ord
  FROM projects
  WHERE pinned = 1
)
UPDATE projects
SET pinned_order = (
  SELECT ord FROM ordered WHERE ordered.id = projects.id
)
WHERE pinned = 1;
