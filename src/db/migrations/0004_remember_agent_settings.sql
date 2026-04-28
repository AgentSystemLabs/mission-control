-- Per-project "remember new agent settings" — when enabled, the New agent
-- button bypasses the modal and spawns a terminal using the saved CLI provider
-- and skip-permissions flag.
ALTER TABLE projects ADD COLUMN remember_agent_settings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN saved_agent TEXT;
ALTER TABLE projects ADD COLUMN saved_skip_permissions INTEGER NOT NULL DEFAULT 0;
