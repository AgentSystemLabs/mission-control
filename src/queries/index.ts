import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";

export const queryKeys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  groups: ["groups"] as const,
  tasks: (projectId: string) => ["projects", projectId, "tasks"] as const,
  settings: ["settings"] as const,
  keybindings: ["keybindings"] as const,
  userTerminals: (projectId: string) =>
    ["projects", projectId, "user-terminals"] as const,
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

export const userTerminalsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.userTerminals(projectId),
    queryFn: async () => (await api.listUserTerminals(projectId)).terminals,
  });

export const useProjects = () => useQuery(projectsQueryOptions());
export const useProject = (id: string) => useQuery(projectQueryOptions(id));
export const useGroups = () => useQuery(groupsQueryOptions());
export const useTasks = (projectId: string) =>
  useQuery(tasksQueryOptions(projectId));
export const useSettings = () => useQuery(settingsQueryOptions());
export const useUserTerminalsQuery = (projectId: string) =>
  useQuery(userTerminalsQueryOptions(projectId));
