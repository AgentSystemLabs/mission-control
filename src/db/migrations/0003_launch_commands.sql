-- Per-project launch command configuration (JSON array of {id,name,command}).
ALTER TABLE projects ADD COLUMN launch_commands TEXT;

-- Optional shell command to run when a user terminal is spawned. Used by the
-- per-project Launch button to mark which terminals it manages.
ALTER TABLE user_terminals ADD COLUMN start_command TEXT;
