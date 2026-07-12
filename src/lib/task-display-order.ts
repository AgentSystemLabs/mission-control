import {
  STATUS_DISPLAY_ORDER,
  TASK_STATUSES,
  type TaskStatus,
} from "~/shared/domain";

type DisplayTask = {
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
};

type PinnableDisplayTask = DisplayTask & {
  pinned: boolean;
};

function byMostRecentActivity<T extends DisplayTask>(a: T, b: T): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;
}

function statusDisplayRank(status: TaskStatus): number {
  return STATUS_DISPLAY_ORDER.indexOf(status);
}

function byPinnedListOrder<T extends DisplayTask>(a: T, b: T): number {
  const rankDelta = statusDisplayRank(a.status) - statusDisplayRank(b.status);
  if (rankDelta !== 0) return rankDelta;
  if (a.status === "finished" || b.status === "finished") {
    return byMostRecentActivity(a, b);
  }
  return 0;
}

export function groupTasksByStatusForDisplay<T extends DisplayTask>(
  tasks: readonly T[],
): Record<TaskStatus, T[]> {
  const grouped = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = [];
      return acc;
    },
    {} as Record<TaskStatus, T[]>,
  );

  for (const task of tasks) grouped[task.status].push(task);

  grouped.finished.sort(byMostRecentActivity);

  return grouped;
}

/**
 * Archived-tab list view: collapse every live status into the Finished/
 * "Archived" bucket. Archived sessions keep their last runtime status in the
 * DB (interrupted, running, …), but the archived tab is parked history — it
 * must never re-surface Interrupted / Running / Ready / etc. columns.
 */
export function groupArchivedTasksForDisplay<T extends DisplayTask>(
  tasks: readonly T[],
): Record<TaskStatus, T[]> {
  const grouped = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = [];
      return acc;
    },
    {} as Record<TaskStatus, T[]>,
  );
  grouped.finished = [...tasks].sort(byMostRecentActivity);
  return grouped;
}

/**
 * Active-tab list view: peel pinned sessions into their own top section, then
 * group the remaining (unpinned) sessions by status as usual.
 */
export function groupActiveListTasksForDisplay<T extends PinnableDisplayTask>(
  tasks: readonly T[],
): { pinned: T[]; byStatus: Record<TaskStatus, T[]> } {
  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const task of tasks) {
    if (task.pinned) pinned.push(task);
    else unpinned.push(task);
  }
  pinned.sort(byPinnedListOrder);
  return {
    pinned,
    byStatus: groupTasksByStatusForDisplay(unpinned),
  };
}
