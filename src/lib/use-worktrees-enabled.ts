import {
  hasCachedWorktreesPreference,
  readCachedWorktreesEnabled,
} from "~/lib/worktrees-preference";
import { useSettings } from "~/queries";

/** Resolves whether git worktrees are enabled, using local cache only until settings load. */
export function useWorktreesEnabled(): boolean {
  const { data: settings } = useSettings();
  if (typeof settings?.worktreesEnabled === "boolean") {
    return settings.worktreesEnabled;
  }
  if (hasCachedWorktreesPreference()) {
    return readCachedWorktreesEnabled();
  }
  return false;
}
