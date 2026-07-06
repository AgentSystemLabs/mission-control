// Warm-start hint that the first-launch theme picker was already dismissed.
// NOT the source of truth: localStorage is origin-scoped and the packaged app
// serves the renderer from a localhost port that can shift between launches,
// wiping this key. The authoritative flag is the server-derived
// `settings.themeChosen` (see ThemeOnboardingGate); this cache only skips the
// settings round-trip on the common path. "1" ⇒ already chosen.
export const THEME_ONBOARDING_CACHE_KEY = "mc:themeOnboardingDone";

/** True once the user has confirmed a theme in the first-launch picker. */
export function hasCompletedThemeOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(THEME_ONBOARDING_CACHE_KEY) === "1";
  } catch {
    // Fail closed: if storage is unreadable, don't trap the user in the picker
    // on every launch — treat it as completed.
    return true;
  }
}

/** Record that the first-launch theme picker has been dismissed. */
export function markThemeOnboardingComplete(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_ONBOARDING_CACHE_KEY, "1");
  } catch {
    // ignore quota / privacy-mode errors
  }
}
