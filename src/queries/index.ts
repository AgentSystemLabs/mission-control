import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";

export const queryKeys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  groups: ["groups"] as const,
  tasks: (projectId: string) => ["projects", projectId, "tasks"] as const,
  settings: ["settings"] as const,
  license: ["license"] as const,
  keybindings: ["keybindings"] as const,
  userTerminals: (projectId: string) =>
    ["projects", projectId, "user-terminals"] as const,
  usage: (days: number) => ["usage", days] as const,
};

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.projects,
    queryFn: async () => (await api.listProjects()).projects,
  });

export const projectQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.project(id),
    queryFn: async () => (await api.getProject(id)).project,
  });

export const groupsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.groups,
    queryFn: async () => (await api.listGroups()).groups,
  });

export const tasksQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.tasks(projectId),
    queryFn: async () => (await api.listTasks(projectId)).tasks,
  });

export const settingsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: async () => api.getSettings(),
  });

export const licenseQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.license,
    queryFn: async () => (await api.getLicense()).license,
  });

export const userTerminalsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.userTerminals(projectId),
    queryFn: async () => (await api.listUserTerminals(projectId)).terminals,
  });

export const usageQueryOptions = (days: number = 30) =>
  queryOptions({
    queryKey: queryKeys.usage(days),
    queryFn: async () => api.getUsage(days),
    staleTime: 30_000,
  });

export const useProjects = () => useQuery(projectsQueryOptions());
export const useProject = (id: string) => useQuery(projectQueryOptions(id));
export const useGroups = () => useQuery(groupsQueryOptions());
export const useTasks = (projectId: string) =>
  useQuery(tasksQueryOptions(projectId));
export const useSettings = () => useQuery(settingsQueryOptions());
export const useLicense = () => useQuery(licenseQueryOptions());
export const useUserTerminalsQuery = (projectId: string) =>
  useQuery(userTerminalsQueryOptions(projectId));
export const useUsage = (days: number = 30) => useQuery(usageQueryOptions(days));
