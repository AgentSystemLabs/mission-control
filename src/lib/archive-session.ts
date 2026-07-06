import type { QueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { OpenTerminal } from "~/lib/terminal-store";
import { queryKeys } from "~/queries";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

type CloseSessionFn = (
  taskId: string,
  opts?: { activateTaskId?: string | null },
) => Promise<void>;

/**
 * Close + archive one open session, scoped to its own project so it works for a
 * session belonging to any project (e.g. cells in the global session grid).
 * Mirrors the close+archive core of archiveTasks in projects.$id.tsx. Throws on
 * failure so callers can surface a toast.
 *
 * Callers archiving many sessions at once should pass `skipInvalidate` and run
 * a single deduped `invalidateSessionQueries` afterwards — the global
 * `projects` key (and any shared per-project keys) must not be invalidated
 * once per session.
 *
 * `activateTaskId` is handed to `close` so the caller can promote a replacement
 * session to active (e.g. the grid activating the closed cell's neighbour);
 * it defaults to null, which leaves the project with no active session.
 */
export async function archiveOpenSession(
  session: OpenTerminal,
  close: CloseSessionFn,
  queryClient: QueryClient,
  opts?: { skipInvalidate?: boolean; activateTaskId?: string | null },
): Promise<void> {
  await close(session.taskId, {
    activateTaskId: opts?.activateTaskId ?? null,
  }).catch(() => undefined);
  await api.archiveTask(session.taskId);
  if (!opts?.skipInvalidate) await invalidateSessionQueries(queryClient, [session]);
}

/** Refresh the queries affected by archiving `sessions`, each key exactly once. */
export async function invalidateSessionQueries(
  queryClient: QueryClient,
  sessions: OpenTerminal[],
): Promise<void> {
  const keys = new Map<string, readonly unknown[]>();
  const add = (queryKey: readonly unknown[]) => keys.set(JSON.stringify(queryKey), queryKey);
  for (const { project } of sessions) {
    add(
      queryKeys.tasks(
        project.id,
        project.activeWorktreeId ?? null,
        project.activeRuntimeScopeId ?? LOCAL_SCOPE_ID,
      ),
    );
    add(queryKeys.project(project.id));
  }
  if (sessions.length > 0) add(queryKeys.projects);
  await Promise.all(
    [...keys.values()].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
