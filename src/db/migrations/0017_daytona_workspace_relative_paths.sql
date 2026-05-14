UPDATE projects
SET workspace_path = CASE
  WHEN EXISTS (
    SELECT 1
    FROM projects AS existing
    WHERE existing.id <> projects.id
      AND COALESCE(existing.workspace_path, existing.path) = CASE
        WHEN projects.workspace_path = '/workspace' THEN 'workspace'
        ELSE 'workspace' || substr(projects.workspace_path, length('/workspace') + 1)
      END
  )
    THEN CASE
      WHEN workspace_path = '/workspace' THEN 'workspace'
      ELSE 'workspace' || substr(workspace_path, length('/workspace') + 1)
    END || '-' || id
  WHEN workspace_path = '/workspace' THEN 'workspace'
  ELSE 'workspace' || substr(workspace_path, length('/workspace') + 1)
END
WHERE runtime_kind <> 'local'
  AND (workspace_path = '/workspace' OR workspace_path LIKE '/workspace/%');

UPDATE projects
SET path = CASE
  WHEN EXISTS (
    SELECT 1
    FROM projects AS existing
    WHERE existing.id <> projects.id
      AND existing.path = CASE
        WHEN projects.path = '/workspace' THEN 'workspace'
        ELSE 'workspace' || substr(projects.path, length('/workspace') + 1)
      END
  )
    THEN CASE
      WHEN path = '/workspace' THEN 'workspace'
      ELSE 'workspace' || substr(path, length('/workspace') + 1)
    END || '-' || id
  WHEN path = '/workspace' THEN 'workspace'
  ELSE 'workspace' || substr(path, length('/workspace') + 1)
END
WHERE runtime_kind <> 'local'
  AND (path = '/workspace' OR path LIKE '/workspace/%');
