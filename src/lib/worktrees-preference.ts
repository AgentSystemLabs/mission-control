import { createBooleanPreferenceCache } from "./boolean-preference-cache";

export const WORKTREES_CACHE_KEY = "mc:worktreesEnabled";

const cache = createBooleanPreferenceCache(WORKTREES_CACHE_KEY);

export const hasCachedWorktreesPreference = cache.has;
export const readCachedWorktreesEnabled = cache.read;
export const writeCachedWorktreesEnabled = cache.write;
