import { TASK_STATUSES, type TaskStatus } from "~/shared/domain";

type DisplayTask = {
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
};

function byMostRecentActivity<T extends DisplayTask>(a: T, b: T): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;
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
