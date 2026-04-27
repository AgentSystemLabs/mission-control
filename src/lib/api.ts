import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { ProjectWithCounts } from "~/server/services/projects";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => req<{ projects: ProjectWithCounts[] }>("/api/projects"),
  getProject: (id: string) => req<{ project: ProjectWithCounts }>(`/api/projects/${id}`),
  createProject: (body: {
    name?: string;
    path: string;
    icon?: string;
    iconColor?: string;
    groupId?: string | null;
  }) =>
    req<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  togglePin: (id: string) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ togglePin: true }),
    }),
  deleteProject: (id: string) =>
    req<void>(`/api/projects/${id}`, { method: "DELETE" }),

  listGroups: () => req<{ groups: Group[] }>("/api/groups"),
  createGroup: (body: { name: string; color?: string }) =>
    req<{ group: Group }>("/api/groups", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateGroup: (id: string, body: { name?: string; color?: string }) =>
    req<{ group: Group }>(`/api/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteGroup: (id: string) =>
    req<void>(`/api/groups/${id}`, { method: "DELETE" }),

  listTasks: (projectId: string) =>
    req<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
  archiveTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/archive`, { method: "POST" }),
  restoreTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/restore`, { method: "POST" }),
  updateTaskStatus: (id: string, body: { status?: string; preview?: string; lines?: number }, token: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/status`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}` },
    }),
  createTaskInternal: (projectId: string, body: { title: string; agent: string; branch?: string }, token: string) =>
    req<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}` },
    }),
  deleteTask: (id: string) => req<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  listArchive: () => req<{ tasks: Task[] }>("/api/archive"),

  listUserTerminals: (projectId: string) =>
    req<{ terminals: UserTerminal[] }>(`/api/projects/${projectId}/user-terminals`),
  createUserTerminal: (
    projectId: string,
    body: { name?: string; cwd?: string | null; startCommand?: string | null }
  ) =>
    req<{ terminal: UserTerminal }>(`/api/projects/${projectId}/user-terminals`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renameUserTerminal: (id: string, name: string) =>
    req<{ terminal: UserTerminal }>(`/api/user-terminals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteUserTerminal: (id: string) =>
    req<void>(`/api/user-terminals/${id}`, { method: "DELETE" }),

  getSettings: () => req<{ apiToken: string }>("/api/settings"),
  regenerateToken: () =>
    req<{ apiToken: string }>("/api/settings", {
      method: "POST",
      body: JSON.stringify({ regenerate: true }),
    }),
};
