import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, setApiToken } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { isWebDaytonaRuntime } from "~/lib/runtime";
import {
  readCachedGroups,
  readCachedLicense,
  readCachedProjects,
  readCachedSandboxes,
  readCachedSettings,
} from "~/lib/shell-query-cache";
import type { LicenseState } from "~/shared/license";
import { filterProjectsByScope, LOCAL_SCOPE_ID } from "~/shared/sandbox";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

export const queryKeys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  sandboxes: ["sandboxes"] as const,
  groups: ["groups"] as const,
  tasks: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    [
      "projects",
      projectId,
      "worktrees",
      worktreeId || MAIN_WORKTREE_ID,
      "scopes",
      scopeId || LOCAL_SCOPE_ID,
      "tasks",
    ] as const,
  worktrees: (projectId: string) => ["projects", projectId, "worktrees"] as const,
  settings: ["settings"] as const,
  apiToken: ["api-token"] as const,
  license: ["license"] as const,
  entitlements: ["entitlements"] as const,
  keybindings: ["keybindings"] as const,
  userTerminals: (projectId: string) =>
    ["projects", projectId, "user-terminals"] as const,
  scopedUserTerminals: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    [
      "projects",
      projectId,
      "worktrees",
      worktreeId || MAIN_WORKTREE_ID,
      "scopes",
      scopeId || LOCAL_SCOPE_ID,
      "user-terminals",
    ] as const,
  usage: (days: number) => ["usage", days] as const,
};

const HOSTED_LICENSE_STATE: LicenseState = {
  hasKey: false,
  maskedKey: null,
  status: null,
  plan: null,
  lastValidatedAt: null,
  payload: null,
};

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.projects,
    queryFn: async () => (await api.listProjects()).projects,
    placeholderData: readCachedProjects,
  });

export const projectQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.project(id),
    queryFn: async () => (await api.getProject(id)).project,
  });

// Full sandbox state for the header scope dropdown: the sandboxes, whether the
// feature is enabled (gates the dropdown), and the selected scope.
export const sandboxesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.sandboxes,
    queryFn: async () => api.listSandboxes(),
    placeholderData: () => readCachedSandboxes(),
  });

export const useSandboxes = () => useQuery(sandboxesQueryOptions());

export const groupsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.groups,
    queryFn: async () => (await api.listGroups()).groups,
    placeholderData: readCachedGroups,
  });

export const tasksQueryOptions = (
  projectId: string,
  worktreeId?: string | null,
  scopeId?: string | null,
) =>
  queryOptions({
    queryKey: queryKeys.tasks(projectId, worktreeId, scopeId),
    queryFn: async () => (await api.listTasks(projectId, worktreeId, scopeId)).tasks,
  });

export const worktreesQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.worktrees(projectId),
    queryFn: async () => (await api.listWorktrees(projectId)).worktrees,
  });

export const settingsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: async () => api.getSettings(),
    placeholderData: readCachedSettings,
  });

// The api bearer token is fetched over Electron IPC, never HTTP — see
// electron/api-token-store.ts. Stays cached indefinitely; only invalidated
// when ApiSettingsPage rotates it. `setApiToken` mirrors the value into the
// module-level cache that `src/lib/api.ts:req` reads on every fetch, so all
// HTTP calls authenticate automatically once this resolves.
export const apiTokenQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.apiToken,
    queryFn: async (): Promise<string | null> => {
      const electron = getElectron();
      if (!electron) {
        return null;
      }
      const token = await electron.settings.getToken();
      setApiToken(token);
      return token;
    },
    staleTime: Infinity,
  });

export const licenseQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.license,
    queryFn: async () => {
      if (!import.meta.env.SSR && isWebDaytonaRuntime()) {
        return HOSTED_LICENSE_STATE;
      }
      return (await api.getLicense()).license;
    },
    placeholderData: readCachedLicense,
  });

export const entitlementsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.entitlements,
    queryFn: async () => (await api.getEntitlements()).entitlements,
  });

export const userTerminalsQueryOptions = (
  projectId: string,
  worktreeId?: string | null,
  scopeId?: string | null,
) =>
  queryOptions({
    queryKey: queryKeys.scopedUserTerminals(projectId, worktreeId, scopeId),
    queryFn: async () => (await api.listUserTerminals(projectId, worktreeId, scopeId)).terminals,
  });

export const DEFAULT_USAGE_DAYS = 30;
const USAGE_STALE_MS = 30_000;

export const usageQueryOptions = (days: number = DEFAULT_USAGE_DAYS) =>
  queryOptions({
    queryKey: queryKeys.usage(days),
    queryFn: async () => api.getUsage(days),
    staleTime: USAGE_STALE_MS,
  });

export const useProjects = () => useQuery(projectsQueryOptions());

/** Projects visible in the active sandbox scope (Local or one sandbox). */
export const useScopedProjects = () => {
  const query = useProjects();
  const { data: sandboxState } = useSandboxes();
  const data = useMemo(() => {
    if (query.data === undefined) return undefined;
    return filterProjectsByScope(query.data, sandboxState);
  }, [query.data, sandboxState]);
  return { ...query, data };
};
export const useProject = (id: string) => useQuery(projectQueryOptions(id));
export const useGroups = () => useQuery(groupsQueryOptions());
export const useTasks = (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
  useQuery(tasksQueryOptions(projectId, worktreeId, scopeId));
export const useWorktrees = (projectId: string) => useQuery(worktreesQueryOptions(projectId));
export const useSettings = () => useQuery(settingsQueryOptions());
export const useApiToken = () => useQuery(apiTokenQueryOptions());
export const useLicense = () => useQuery(licenseQueryOptions());
export const useEntitlements = () => useQuery(entitlementsQueryOptions());
export const useUserTerminalsQuery = (
  projectId: string,
  worktreeId?: string | null,
  scopeId?: string | null,
) => useQuery(userTerminalsQueryOptions(projectId, worktreeId, scopeId));
export const useUsage = (days: number = DEFAULT_USAGE_DAYS) =>
  useQuery(usageQueryOptions(days));
