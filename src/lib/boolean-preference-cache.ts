/**
 * An SSR-safe boolean flag persisted in localStorage as `"1"` / `"0"`.
 *
 * - `has()` — whether the key has ever been written (distinguishes "unset").
 * - `read()` — the stored flag, defaulting to `false`.
 * - `write(enabled)` — persist the flag.
 *
 * Outside the browser `has`/`read` return `false` and `write` is a no-op; all
 * three swallow quota / privacy-mode errors. Companion to `local-storage-json`,
 * which handles JSON values rather than a single boolean.
 */
export function createBooleanPreferenceCache(key: string): {
  has: () => boolean;
  read: () => boolean;
  write: (enabled: boolean) => void;
} {
  return {
    has() {
      if (typeof window === "undefined") return false;
      try {
        return window.localStorage.getItem(key) !== null;
      } catch {
        return false;
      }
    },
    read() {
      if (typeof window === "undefined") return false;
      try {
        return window.localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    write(enabled: boolean) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, enabled ? "1" : "0");
      } catch {
        // ignore quota / privacy-mode errors
      }
    },
  };
}
