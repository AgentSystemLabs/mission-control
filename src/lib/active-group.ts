import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type AppSettings } from "~/lib/api";
import {
  readCachedActiveProjectGroup,
  writeCachedActiveProjectGroup,
} from "~/lib/ui-preference-cache";
import { queryKeys, useGroups, useScopedProjects, useSettings } from "~/queries";
import {
  ACTIVE_GROUP_ALL,
  ACTIVE_GROUP_UNGROUPED,
  type ActiveProjectGroup,
} from "~/shared/ui-preferences";
import type { Group } from "~/db/schema";

export { ACTIVE_GROUP_ALL, ACTIVE_GROUP_UNGROUPED } from "~/shared/ui-preferences";
export type { ActiveProjectGroup } from "~/shared/ui-preferences";

export function isGroupIdActive(active: ActiveProjectGroup): boolean {
  return active !== ACTIVE_GROUP_ALL && active !== ACTIVE_GROUP_UNGROUPED;
}

/** Projects visible under an active group ("all" passes everything through). */
export function filterProjectsByActiveGroup<T extends { groupId: string | null }>(
  projects: T[],
  active: ActiveProjectGroup,
): T[] {
  if (active === ACTIVE_GROUP_ALL) return projects;
  if (active === ACTIVE_GROUP_UNGROUPED) return projects.filter((p) => p.groupId == null);
  return projects.filter((p) => p.groupId === active);
}

/** Display label for the active group ("All projects" / "Ungrouped" / group name). */
export function activeGroupLabel(
  active: ActiveProjectGroup,
  groups: Group[] | undefined,
): string {
  if (active === ACTIVE_GROUP_ALL) return "All projects";
  if (active === ACTIVE_GROUP_UNGROUPED) return "Ungrouped";
  return groups?.find((g) => g.id === active)?.name ?? "All projects";
}

/**
 * The globally active project group — the single source of truth is the
 * settings query cache (so every consumer re-renders together); localStorage
 * seeds the value before settings hydrate, and the server `app_settings` KV
 * makes it durable across restarts (same dual-write pattern as
 * `projectsDashboardView`).
 */
export function useActiveGroup(): {
  activeGroup: ActiveProjectGroup;
  setActiveGroup: (next: ActiveProjectGroup) => void;
  groups: Group[];
} {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const groupsQuery = useGroups();
  const groups = groupsQuery.data;

  const raw: ActiveProjectGroup =
    settings === undefined
      ? (readCachedActiveProjectGroup() ?? ACTIVE_GROUP_ALL)
      : (settings.activeProjectGroup ?? ACTIVE_GROUP_ALL);

  // A stale group id (group deleted, possibly by another window) falls back to
  // "all" — but only once the group list has actually loaded, so a slow fetch
  // doesn't flash the unscoped view.
  const activeGroup = useMemo(() => {
    if (!isGroupIdActive(raw)) return raw;
    if (groups === undefined) return raw;
    return groups.some((g) => g.id === raw) ? raw : ACTIVE_GROUP_ALL;
  }, [raw, groups]);

  const setActiveGroup = useCallback(
    (next: ActiveProjectGroup) => {
      writeCachedActiveProjectGroup(next);
      queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
        current ? { ...current, activeProjectGroup: next === ACTIVE_GROUP_ALL ? null : next } : current,
      );
      void api
        .updateSettings({ activeProjectGroup: next === ACTIVE_GROUP_ALL ? null : next })
        .then((updated) => queryClient.setQueryData(queryKeys.settings, updated))
        .catch((error) => {
          console.error("[settings] failed to persist active project group:", error);
        });
    },
    [queryClient],
  );

  // Self-heal persistence when the active group was deleted: the memo above
  // already renders "all"; this clears the stale id so restarts agree.
  useEffect(() => {
    if (!isGroupIdActive(raw)) return;
    if (groups === undefined) return;
    if (!groups.some((g) => g.id === raw)) setActiveGroup(ACTIVE_GROUP_ALL);
  }, [raw, groups, setActiveGroup]);

  return { activeGroup, setActiveGroup, groups: groups ?? [] };
}

/**
 * Projects visible in the active sandbox scope AND the active group — the
 * list the dashboard, left rail, and project picker should render.
 */
export function useGroupScopedProjects() {
  const query = useScopedProjects();
  const { activeGroup, setActiveGroup, groups } = useActiveGroup();
  const data = useMemo(() => {
    if (query.data === undefined) return undefined;
    return filterProjectsByActiveGroup(query.data, activeGroup);
  }, [query.data, activeGroup]);
  return { ...query, data, unscopedData: query.data, activeGroup, setActiveGroup, groups };
}
