import {
  hasCachedWorktreesPreference,
  readCachedWorktreesEnabled,
} from "~/lib/worktrees-preference";
import { useSettings } from "~/queries";

/** Resolves whether git worktrees are enabled, preferring the local cache written by Settings. */
export function useWorktreesEnabled(): boolean {
  const { data: settings } = useSettings();
  if (hasCachedWorktreesPreference()) {
    return readCachedWorktreesEnabled();
  }
  return settings?.worktreesEnabled ?? false;
}
