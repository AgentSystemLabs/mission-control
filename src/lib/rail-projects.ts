import type { Group } from "~/db/schema";
import { getPinnedProjects, type PinnedOrderable } from "~/lib/pinned-project-order";
import {
  ACTIVE_GROUP_ALL,
  ACTIVE_GROUP_UNGROUPED,
  type ActiveProjectGroup,
} from "~/shared/ui-preferences";

export type RailProject = PinnedOrderable & {
  groupId: string | null;
  name: string;
};

/** One visual cluster in the left rail — a run of tiles under one group. */
export type RailCluster<T extends RailProject> = {
  key: string;
  label: string;
  color: string | null;
  projects: T[];
};

/**
 * Cluster an already-ordered pinned list by group (group order first, then
 * ungrouped) without disturbing the relative pinned order inside a cluster.
 * Drives the "all projects" rail: clusters render with color divider lines.
 */
export function clusterPinnedByGroup<T extends RailProject>(
  orderedPinned: readonly T[],
  groups: readonly Group[],
): RailCluster<T>[] {
  const clusters: RailCluster<T>[] = [];
  for (const group of groups) {
    const members = orderedPinned.filter((p) => p.groupId === group.id);
    if (members.length === 0) continue;
    clusters.push({ key: group.id, label: group.name, color: group.color, projects: members });
  }
  const groupIds = new Set(groups.map((g) => g.id));
  const ungrouped = orderedPinned.filter((p) => p.groupId == null || !groupIds.has(p.groupId));
  if (ungrouped.length > 0) {
    clusters.push({ key: "ungrouped", label: "Ungrouped", color: null, projects: ungrouped });
  }
  return clusters;
}

/**
 * The rail as a single group's workspace: every project in the active group,
 * pinned first (in pinned order), the rest alphabetical.
 */
export function getGroupRailCluster<T extends RailProject>(
  projects: readonly T[],
  groups: readonly Group[],
  activeGroup: ActiveProjectGroup,
): RailCluster<T> {
  const inGroup =
    activeGroup === ACTIVE_GROUP_UNGROUPED
      ? projects.filter((p) => p.groupId == null)
      : projects.filter((p) => p.groupId === activeGroup);
  const pinned = getPinnedProjects(inGroup);
  const rest = inGroup
    .filter((p) => !p.pinned)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const group = groups.find((g) => g.id === activeGroup);
  return {
    key: activeGroup,
    label: activeGroup === ACTIVE_GROUP_UNGROUPED ? "Ungrouped" : (group?.name ?? "Group"),
    color: group?.color ?? null,
    projects: [...pinned, ...rest],
  };
}

export function getRailClusters<T extends RailProject>(
  projects: readonly T[],
  groups: readonly Group[],
  activeGroup: ActiveProjectGroup,
): RailCluster<T>[] {
  if (activeGroup === ACTIVE_GROUP_ALL) {
    return clusterPinnedByGroup(getPinnedProjects(projects), groups);
  }
  const cluster = getGroupRailCluster(projects, groups, activeGroup);
  return cluster.projects.length > 0 ? [cluster] : [];
}

/**
 * The flat, visible rail order — the single source of truth for the ⌘1–9
 * pinned-slot hotkeys AND the rail's slot badges, so they can never disagree.
 */
export function getRailProjects<T extends RailProject>(
  projects: readonly T[],
  groups: readonly Group[],
  activeGroup: ActiveProjectGroup,
): T[] {
  return getRailClusters(projects, groups, activeGroup).flatMap((c) => c.projects);
}
