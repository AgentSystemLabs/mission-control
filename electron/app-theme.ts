// Authoritative light/dark theme as known by the MAIN process.
//
// Spawn-time theme hints (COLORFGBG / MC_THEME) used to come only from the
// renderer window that initiated the spawn, read off that window's
// <html data-theme>. With multiple windows (focus windows, floating panes) a
// stale window could bake the OLD theme into a new agent's environment — the
// CLI then boots with the wrong palette (e.g. dark-theme grays on a white
// terminal). Main instead tracks the app theme centrally: seeded from the
// persisted window background at launch and updated on every
// appSetBackgroundColor IPC (which fires whenever the renderer re-themes).
export type AppTheme = "dark" | "light";

let current: AppTheme | null = null;

export function setAppThemeFromBackground(hexColor: string): void {
  const theme = themeFromBackgroundHex(hexColor);
  if (theme) current = theme;
}

/** Last known app theme, or null before the first background sync. */
export function getAppTheme(): AppTheme | null {
  return current;
}

/** Classify a #rgb/#rrggbb window background as a light or dark theme. */
export function themeFromBackgroundHex(hexColor: string): AppTheme | null {
  const hex = hexColor.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex.replace(/./g, (c) => c + c)
      : hex.length === 6
        ? hex
        : null;
  if (!full || /[^0-9a-f]/i.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived luminance (ITU-R BT.601); themes sit far from the midpoint
  // (near-black vs near-white grounds), so a 0.5 cut is unambiguous.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.5 ? "light" : "dark";
}

/** Test-only reset. */
export function resetAppThemeForTests(): void {
  current = null;
}
