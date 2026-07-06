import { createBooleanPreferenceCache } from "./boolean-preference-cache";

export const LAUNCH_INTRO_CACHE_KEY = "mc:launchOverlayEnabled";

const cache = createBooleanPreferenceCache(LAUNCH_INTRO_CACHE_KEY);

export const hasCachedLaunchIntroPreference = cache.has;
export const readCachedLaunchIntroEnabled = cache.read;
export const writeCachedLaunchIntroEnabled = cache.write;

export function setDocumentLaunchIntroActive(active: boolean): void {
  if (typeof document === "undefined") return;
  if (active) document.documentElement.setAttribute("data-launch-intro", "true");
  else document.documentElement.removeAttribute("data-launch-intro");
}
