import type { QueryClient } from "@tanstack/react-query";
import type { Task } from "~/db/schema";
import { DEFAULT_BRANCH, DEFAULT_TASK_STATUS, type TaskAgent } from "~/shared/domain";
import { queryKeys } from "~/queries";
import { TITLE_WAITING } from "~/lib/task-sentinels";
import { newClientId } from "~/shared/client-id";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

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
  scopeId?: string | null;
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
    scopeId: input.scopeId?.trim() || LOCAL_SCOPE_ID,
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

function tasksQueryKey(projectId: string, worktreeId: string | null, scopeId?: string | null) {
  return queryKeys.tasks(projectId, worktreeId, scopeId);
}

export function removeTaskFromCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  taskId: string,
  scopeId?: string | null,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId, scopeId), (current) =>
    (current ?? []).filter((t) => t.id !== taskId),
  );
}

export function removeTasksFromCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  taskIds: Iterable<string>,
  scopeId?: string | null,
) {
  const ids = taskIds instanceof Set ? taskIds : new Set(taskIds);
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId, scopeId), (current) =>
    (current ?? []).filter((t) => !ids.has(t.id)),
  );
}

export function restoreTasksCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  tasks: Task[],
  scopeId?: string | null,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId, scopeId), tasks);
}

export function setTaskArchivedInCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  taskId: string,
  archived: boolean,
  scopeId?: string | null,
) {
  setTasksArchivedInCache(queryClient, projectId, worktreeId, [taskId], archived, scopeId);
}

export function setTasksArchivedInCache(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  taskIds: Iterable<string>,
  archived: boolean,
  scopeId?: string | null,
) {
  const ids = taskIds instanceof Set ? taskIds : new Set(taskIds);
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId, scopeId), (current) =>
    (current ?? []).map((t) => (ids.has(t.id) ? { ...t, archived } : t)),
  );
}

export function appendOptimisticTask(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string | null,
  task: Task,
  scopeId?: string | null,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId, scopeId), (current) => [
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
  scopeId?: string | null,
) {
  queryClient.setQueryData<Task[]>(tasksQueryKey(projectId, worktreeId, scopeId), (current) => {
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
  scopeId?: string | null,
) {
  removeTaskFromCache(queryClient, projectId, worktreeId, optimisticId, scopeId);
}
