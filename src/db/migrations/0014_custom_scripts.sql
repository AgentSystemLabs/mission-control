-- Per-project custom scripts (JSON array of {id,name,command}). Distinct from
-- launch_commands: these run individually on demand from a header split button
-- and have no launch/stop lifecycle.
ALTER TABLE projects ADD COLUMN custom_scripts TEXT;
