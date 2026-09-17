import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type AppSettings } from "~/lib/api";
import {
  readCachedCollapsedProjectGroups,
  writeCachedCollapsedProjectGroups,
} from "~/lib/ui-preference-cache";
import { queryKeys, useSettings } from "~/queries";

/** Section keys for the two non-group dashboard sections. */
export const COLLAPSED_SECTION_PINNED = "pinned";
export const COLLAPSED_SECTION_UNGROUPED = "ungrouped";

/**
 * Collapsed dashboard section keys (group ids + "pinned"/"ungrouped"), on the
 * same dual-write persistence as the active group: settings query cache is
 * the source of truth, localStorage seeds pre-hydration, app_settings KV
 * makes it durable.
 */
export function useCollapsedGroups(): {
  isCollapsed: (key: string) => boolean;
  toggleCollapsed: (key: string) => void;
} {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const collapsed =
    settings === undefined
      ? (readCachedCollapsedProjectGroups() ?? [])
      : (settings.collapsedProjectGroups ?? []);

  const isCollapsed = useCallback((key: string) => collapsed.includes(key), [collapsed]);

  const toggleCollapsed = useCallback(
    (key: string) => {
      const next = collapsed.includes(key)
        ? collapsed.filter((entry) => entry !== key)
        : [...collapsed, key];
      writeCachedCollapsedProjectGroups(next);
      queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
        current ? { ...current, collapsedProjectGroups: next } : current,
      );
      void api
        .updateSettings({ collapsedProjectGroups: next })
        .then((updated) => queryClient.setQueryData(queryKeys.settings, updated))
        .catch((error) => {
          console.error("[settings] failed to persist collapsed project groups:", error);
        });
    },
    [collapsed, queryClient],
  );

  return { isCollapsed, toggleCollapsed };
}
