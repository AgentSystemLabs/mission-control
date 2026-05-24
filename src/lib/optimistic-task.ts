import type { QueryClient } from "@tanstack/react-query";
import type { Task } from "~/db/schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, type TaskAgent } from "~/shared/domain";
import { queryKeys } from "~/queries";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { newClientId } from "~/shared/client-id";

export const OPTIMISTIC_TASK_ID_PREFIX = "t-opt-";

export function isOptimisticTaskId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_TASK_ID_PREFIX);
}

export function newOptimisticTaskId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${OPTIMISTIC_TASK_ID_PREFIX}${suffix}`;
}

export function buildOptimisticTask(input: {
  id?: string;
  projectId: string;
  worktreeId: string | null;
  agent: TaskAgent;
  branch: string;
  claudeSessionId?: string | null;
  claudeSkipPermissions?: boolean;
  claudeBareSession?: boolean;
}): Task {
  const now = Date.now();
  return {
    id: input.id ?? newOptimisticTaskId(),
    projectId: input.projectId,
    worktreeId: input.worktreeId,
    title: TITLE_WAITING,
    icon: null,
    agent: input.agent,
    status: DEFAULT_TASK_STATUS,
    branch: input.branch || DEFAULT_BRANCH,
    preview: "",
    lines: 0,
    archived: false,
    claudeSessionId: input.claudeSessionId ?? null,
    claudeSkipPermissions: input.claudeSkipPermissions ?? false,
    claudeBareSession: input.claudeBareSession ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

function tasksQueryKey(projectId: string, worktreeId: string | null) {
  return queryKeys.tasks(projectId, worktreeId);
}

export function removeTaskFromCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  taskId: string,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId), (current) =>
    (current ?? []).filter((t) => t.id !== taskId),
  );
}

export function removeTasksFromCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  taskIds: Iterable<string>,
) {
  const ids = taskIds instanceof Set ? taskIds : new Set(taskIds);
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId), (current) =>
    (current ?? []).filter((t) => !ids.has(t.id)),
  );
}

export function restoreTasksCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  tasks: Task[],
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId), tasks);
}

export function appendOptimisticTask(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  task: Task,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId), (current) => [
    task,
    ...(current ?? []),
  ]);
}

export function replaceOptimisticTask(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  optimisticId: string,
  task: Task,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId), (current) => {
    const withoutOptimistic = (current ?? []).filter((t) => t.id !== optimisticId);
    if (withoutOptimistic.some((t) => t.id === task.id)) return withoutOptimistic;
    return [task, ...withoutOptimistic];
  });
}

export function removeOptimisticTask(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  optimisticId: string,
) {
  removeTaskFromCache(queryClient, projectId, worktreeId, optimisticId);
}
