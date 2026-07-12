// Lightweight, dependency-free source of truth for the settings panel ids.
// Split out of SettingsPanel.tsx so eager importers (the __root shell and the
// /settings deep-link route) can reference the id union without pulling the
// whole SettingsPanel module — and its dozen settings pages, the pet cluster,
// etc. — into the eager entry chunk. SettingsPanel itself is lazy-loaded.
export const SETTINGS_PANEL_IDS = [
  "general",
  "defaults",
  "providers",
  "usage",
  "terminal",
  "session",
  "theme",
  "voice",
  "recall",
  "beta",
  "keybindings",
  "terms",
] as const;

export type SettingsPanelId = (typeof SETTINGS_PANEL_IDS)[number];
