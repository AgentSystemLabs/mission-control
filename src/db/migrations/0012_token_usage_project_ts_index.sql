-- Composite index for usage rollups scoped to a project + time window.
-- getUsageSummary() filters by project_id and orders by ts; the existing
-- single-column indexes force two index scans + a merge.
CREATE INDEX IF NOT EXISTS token_usage_project_ts_idx ON token_usage (project_id, ts);
