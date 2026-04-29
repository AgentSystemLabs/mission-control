import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { ProjectWithCounts } from "~/server/services/projects";
import type { GitDiff, GitStatus, PushResult } from "~/server/services/git";
import type { Binding, BindingMap, HotkeyAction } from "~/lib/keybindings/types";
import type { AccentColorId } from "~/lib/accent-colors";

export type AppSettings = {
  apiToken: string;
  agentSystemBannerDisabled: boolean;
  accentColor: AccentColorId;
};

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Node's fetch (used during TanStack Start SSR) rejects relative URLs.
  // In the browser the page origin is implicit; on the server, prepend the
  // Vite dev origin so loader prefetches resolve correctly.
  const resolved =
    typeof window === "undefined" && url.startsWith("/")
      ? (process.env.MC_DEV_URL ?? "http://127.0.0.1:5173") + url
      : url;
  const res = await fetch(resolved, {
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
  updateProjectLaunchUrl: (id: string, launchUrl: string | null) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ launchUrl }),
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
  createTaskInternal: (
    projectId: string,
    body: {
      title: string;
      agent: string;
      branch?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
    },
    token: string
  ) =>
    req<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}` },
    }),
  updateTask: (
    id: string,
    body: {
      title?: string;
      branch?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
    }
  ) =>
    req<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTask: (id: string) => req<void>(`/api/tasks/${id}`, { method: "DELETE" }),

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

  getKeybindings: () => req<{ bindings: BindingMap }>("/api/keybindings"),
  setKeybinding: (action: HotkeyAction, binding: Binding) =>
    req<{ bindings: BindingMap }>("/api/keybindings", {
      method: "PUT",
      body: JSON.stringify({ action, binding }),
    }),
  resetKeybinding: (action: HotkeyAction) =>
    req<{ bindings: BindingMap }>(`/api/keybindings?action=${encodeURIComponent(action)}`, {
      method: "DELETE",
    }),
  resetAllKeybindings: () =>
    req<{ bindings: BindingMap }>("/api/keybindings", { method: "DELETE" }),

  getSettings: () => req<AppSettings>("/api/settings"),
  updateSettings: (body: Partial<Pick<AppSettings, "agentSystemBannerDisabled" | "accentColor">>) =>
    req<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  regenerateToken: () =>
    req<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify({ regenerate: true }),
    }),

  getGitStatus: (projectId: string) =>
    req<GitStatus>(`/api/projects/${projectId}/git/status`),
  getGitDiff: (projectId: string, file: string, staged: boolean) =>
    req<GitDiff>(
      `/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}&staged=${staged ? "1" : "0"}`,
    ),
  stageFiles: (projectId: string, files: string[]) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/stage`, {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  unstageFiles: (projectId: string, files: string[]) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/unstage`, {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  gitCommit: (projectId: string, message: string) =>
    req<{ sha: string }>(`/api/projects/${projectId}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  gitPush: (projectId: string) =>
    req<PushResult>(`/api/projects/${projectId}/git/push`, { method: "POST" }),
  generateCommitMessage: (projectId: string) =>
    req<{ message: string }>(
      `/api/projects/${projectId}/git/generate-commit-message`,
      { method: "POST" },
    ),
};
