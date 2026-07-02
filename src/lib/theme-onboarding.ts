// Marks whether the user has seen the first-launch theme picker. Purely a local
// (per-machine) flag — the chosen theme itself persists to app settings. Absent
// key ⇒ show the picker; "1" ⇒ already chosen. Mirrors launch-intro.ts.
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
