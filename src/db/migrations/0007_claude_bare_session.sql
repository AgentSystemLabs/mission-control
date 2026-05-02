-- Persist whether a Claude Code task should launch with --bare so task
-- startup, duplicate sessions, and resume fallback all rebuild the same
-- command. Also let remembered new-session settings carry the option.
ALTER TABLE tasks ADD COLUMN claude_bare_session INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN saved_bare_session INTEGER NOT NULL DEFAULT 0;
