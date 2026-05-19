export const LAUNCH_INTRO_CACHE_KEY = "mc:launchOverlayEnabled";

export function hasCachedLaunchIntroPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LAUNCH_INTRO_CACHE_KEY) !== null;
  } catch {
    return false;
  }
}

export function readCachedLaunchIntroEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LAUNCH_INTRO_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCachedLaunchIntroEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAUNCH_INTRO_CACHE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function setDocumentLaunchIntroActive(active: boolean): void {
  if (typeof document === "undefined") return;
  if (active) document.documentElement.setAttribute("data-launch-intro", "true");
  else document.documentElement.removeAttribute("data-launch-intro");
}
