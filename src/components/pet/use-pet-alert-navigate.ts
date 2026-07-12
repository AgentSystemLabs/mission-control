import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { requestSessionOpenById } from "~/lib/session-notification-store";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";
import type { Task } from "~/db/schema";

/**
 * Jump to the session a pet alert points at. Shared by PetWidget (an in-window
 * alert click) and PetHost (the same click forwarded from the desktop overlay,
 * where no router exists). Best effort: find the task in any cached tasks
 * query to recover its worktree/scope; fall back to the local scope (mirrors
 * the OS-notification click-through in use-session-finish-notifications).
 */
export function usePetAlertNavigate(): (navigateTo: {
  taskId: string;
  projectId: string;
}) => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(
    (navigateTo: { taskId: string; projectId: string }) => {
      let task: Task | undefined;
      for (const [, data] of queryClient.getQueriesData<{ tasks?: Task[] } | Task[]>({
        queryKey: ["projects", navigateTo.projectId, "tasks"],
      })) {
        const tasks = Array.isArray(data) ? data : data?.tasks;
        task = tasks?.find((t) => t.id === navigateTo.taskId);
        if (task) break;
      }
      requestSessionOpenById({
        projectId: navigateTo.projectId,
        worktreeId: task?.worktreeId ?? null,
        scopeId: task?.scopeId ?? LOCAL_SCOPE_ID,
        taskId: navigateTo.taskId,
      });
      void router.navigate({ to: "/projects/$id", params: { id: navigateTo.projectId } });
    },
    [router, queryClient],
  );
}
