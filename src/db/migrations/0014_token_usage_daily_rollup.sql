-- Pre-aggregated daily rollup of token_usage so the /usage page doesn't have
-- to SUM over every raw row on every open. The rollup is keyed by local day
-- (YYYY-MM-DD) + project_id and is maintained incrementally inside doSync()'s
-- transaction. We backfill from the existing token_usage rows here so the
-- rollup is correct immediately after migration.
CREATE TABLE token_usage_daily_rollup (
  day TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, project_id)
);

CREATE INDEX token_usage_daily_rollup_day_idx ON token_usage_daily_rollup (day);

INSERT INTO token_usage_daily_rollup (
  day, project_id, input_tokens, output_tokens,
  cache_creation_tokens, cache_read_tokens, request_count
)
SELECT
  strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
  project_id,
  COALESCE(SUM(input_tokens), 0),
  COALESCE(SUM(output_tokens), 0),
  COALESCE(SUM(cache_creation_tokens), 0),
  COALESCE(SUM(cache_read_tokens), 0),
  COUNT(*)
FROM token_usage
GROUP BY day, project_id;
