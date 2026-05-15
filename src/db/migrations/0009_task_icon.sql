-- AI-picked glyph for the session card. Set alongside the auto-generated
-- title; chosen from a curated whitelist of names shipped by the Icon
-- component. NULL means "use the agent default" so older rows still render.
ALTER TABLE tasks ADD COLUMN icon TEXT;
