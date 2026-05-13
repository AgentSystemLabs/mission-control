-- Cache the resolved GitHub URL per project so listProjects() doesn't fan out
-- a .git/config readFile() per row (N+1 fs hits during the most-frequent
-- request in the app). Lazy backfill: NULL means "not yet detected"; the next
-- createProject/updateProject that touches `path` populates it.
ALTER TABLE projects ADD COLUMN github_url TEXT;
