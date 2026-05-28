import type { Group } from "~/db/schema";
import {
  getProjectActivity,
  isProjectActive,
  type ProjectActivityState,
  type ProjectWithCounts,
} from "~/shared/projects";

export const PROJECT_SORT_COLUMNS = [
  "name",
  "group",
  "status",
  "running",
  "createdAt",
  "updatedAt",
  "pinned",
] as const;

export type ProjectSortColumn = (typeof PROJECT_SORT_COLUMNS)[number];
export type SortDirection = "asc" | "desc";

export type ProjectSortState = {
  column: ProjectSortColumn;
  direction: SortDirection;
};

export const DEFAULT_PROJECT_SORT: ProjectSortState = {
  column: "updatedAt",
  direction: "desc",
};

const ACTIVITY_RANK: Record<ProjectActivityState, number> = {
  offline: 0,
  "launch-running": 1,
  "agent-running": 2,
  "needs-input": 3,
  interrupted: 4,
};

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareBooleans(a: boolean, b: boolean): number {
  return Number(a) - Number(b);
}

function groupNameForProject(
  project: ProjectWithCounts,
  groupById: ReadonlyMap<string, Group>,
): string {
  if (!project.groupId) return "\uffff";
  return groupById.get(project.groupId)?.name ?? "\uffff";
}

export function sortProjects(
  projects: readonly ProjectWithCounts[],
  groups: readonly Group[],
  sort: ProjectSortState,
  launchRunningProjectIds: ReadonlySet<string>,
): ProjectWithCounts[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...projects].sort((left, right) => {
    let result = 0;

    switch (sort.column) {
      case "name":
        result = compareStrings(left.name, right.name);
        break;
      case "group":
        result = compareStrings(
          groupNameForProject(left, groupById),
          groupNameForProject(right, groupById),
        );
        break;
      case "status": {
        const leftActivity = getProjectActivity(left, launchRunningProjectIds);
        const rightActivity = getProjectActivity(right, launchRunningProjectIds);
        result = compareNumbers(ACTIVITY_RANK[leftActivity], ACTIVITY_RANK[rightActivity]);
        if (result === 0) {
          result = compareBooleans(isProjectActive(leftActivity), isProjectActive(rightActivity));
        }
        break;
      }
      case "running":
        result = compareNumbers(left.taskCounts.running, right.taskCounts.running);
        if (result === 0) {
          result = compareNumbers(left.taskCounts.activeNonDone, right.taskCounts.activeNonDone);
        }
        break;
      case "createdAt":
        result = compareNumbers(left.createdAt, right.createdAt);
        break;
      case "updatedAt":
        result = compareNumbers(left.updatedAt, right.updatedAt);
        break;
      case "pinned":
        result = compareBooleans(left.pinned, right.pinned);
        break;
    }

    if (result === 0) {
      result = compareStrings(left.name, right.name);
    }

    return result * direction;
  });
}

export function toggleProjectSort(
  current: ProjectSortState,
  column: ProjectSortColumn,
): ProjectSortState {
  if (current.column === column) {
    return {
      column,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return {
    column,
    direction: column === "name" || column === "group" ? "asc" : "desc",
  };
}
