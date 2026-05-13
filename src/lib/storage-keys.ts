/**
 * Canonical localStorage keys used by the renderer.
 *
 * IMPORTANT: do NOT change any of these string values — they map to user state
 * already persisted in the wild. Changing a value would orphan that state.
 *
 * Separator convention going forward: `mc:` (colon-namespaced). Existing keys
 * that predate the convention (`mc.theme`, `mc.userTerminalPanelOpen`,
 * `mc.terminalActiveByProject`, `mc-settings-active-panel`) are kept as-is
 * for backward compatibility — new keys should use `mc:`.
 */
export const STORAGE_KEYS = {
  // Legacy dot-namespaced (kept as-is for backcompat)
  theme: "mc.theme",
  userTerminalPanelOpen: "mc.userTerminalPanelOpen",
  terminalActiveByProject: "mc.terminalActiveByProject",
  // Legacy dash-namespaced (kept as-is for backcompat)
  settingsActivePanel: "mc-settings-active-panel",
  // Colon-namespaced (the canonical convention for new keys)
  userTerminalsPanelHeight: "mc:userTerminalsPanelHeight",
  agentsPanelWidth: "mc:agentsPanelWidth",
  gitDiffChangedFilesWidth: "mc:gitDiffChangedFilesWidth",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Per-project terminal-expanded flag. Keep prefix stable; value is dynamic. */
export function terminalExpandedKey(projectId: string): string {
  return `mc:terminalExpanded:${projectId}`;
}
