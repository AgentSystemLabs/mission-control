export const WORKTREES_CACHE_KEY = "mc:worktreesEnabled";

export function hasCachedWorktreesPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WORKTREES_CACHE_KEY) !== null;
  } catch {
    return false;
  }
}

export function readCachedWorktreesEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WORKTREES_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCachedWorktreesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKTREES_CACHE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore quota / privacy-mode errors
  }
}
