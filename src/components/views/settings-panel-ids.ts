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
  "interface",
  "theme",
  "pet",
  "voice",
  "recall",
  "keybindings",
  "terms",
] as const;

export type SettingsPanelId = (typeof SETTINGS_PANEL_IDS)[number];

// Panels that were renamed or merged away keep their old ids working in deep
// links (/settings?panel=…), OPEN_SETTINGS_EVENT details, and the
// localStorage-remembered last-open panel.
const LEGACY_PANEL_ALIASES: Record<string, SettingsPanelId> = {
  // "Session buttons" grew into the Interface page (all UI visibility toggles).
  session: "interface",
  // Experimental graduated; old links now open the main settings page.
  beta: "general",
  sandbox: "general",
  // Recall's old "memory" panel id now maps to its restored "recall" page.
  memory: "recall",
};

export function normalizeSettingsPanelId(raw: string | null | undefined): SettingsPanelId | null {
  if (!raw) return null;
  const aliased = LEGACY_PANEL_ALIASES[raw] ?? raw;
  return SETTINGS_PANEL_IDS.includes(aliased as SettingsPanelId)
    ? (aliased as SettingsPanelId)
    : null;
}
