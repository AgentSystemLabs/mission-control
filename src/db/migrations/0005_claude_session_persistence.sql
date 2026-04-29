-- Persist Claude Code session IDs so a task's conversation can be resumed
-- after the app restarts (which kills all PTYs). Also persist whether the
-- session was launched with --dangerously-skip-permissions so resume matches
-- the original spawn.
ALTER TABLE tasks ADD COLUMN claude_session_id TEXT;
ALTER TABLE tasks ADD COLUMN claude_skip_permissions INTEGER NOT NULL DEFAULT 0;

-- One-time cleanup: pre-feature claude-code tasks have no session to resume.
-- Per product decision, drop them rather than orphan stale "running" cards.
DELETE FROM tasks
WHERE agent = 'claude-code' AND claude_session_id IS NULL;

-- Any claude-code task that survives but is in an active state has a dead
-- PTY (app just (re)started). Mark as 'disconnected' so the UI signals that
-- clicking will resume.
UPDATE tasks
SET status = 'disconnected', updated_at = strftime('%s','now') * 1000
WHERE agent = 'claude-code' AND status IN ('running', 'needs-input', 'ready');
