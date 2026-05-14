import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { ProjectWithCounts } from "~/shared/projects";
import { DEV_SERVER_ORIGIN } from "~/shared/dev-server";
import type {
  CommitResult,
  GitDiff,
  GitStatus,
  PushResult,
} from "~/server/services/git";
import type { Binding, BindingMap, HotkeyAction } from "~/lib/keybindings/types";
import type { AccentColorId } from "~/lib/accent-colors";
import type { UsageSummary } from "~/shared/token-usage";
import type { LicenseState } from "~/shared/license";
import { apiErrorCode, isApiErrorEnvelope } from "~/shared/api-errors";

export type AppSettings = {
  agentSystemBannerDisabled: boolean;
  accentColor: AccentColorId;
  mouseGradientDisabled: boolean;
  sessionFinishToastEnabled: boolean;
  sessionFinishOsNotificationEnabled: boolean;
  launchAudioDisabled: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly code: string | null = apiErrorCode(body),
    public readonly details: unknown = isApiErrorEnvelope(body) ? body.details : null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let cachedToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

function rememberApiToken(token: string | null | undefined): string {
  const trimmed = (token ?? "").trim();
  if (!trimmed) {
    cachedToken = null;
    return "";
  }
  cachedToken = trimmed;
  return trimmed;
}

function clearApiTokenCache(): void {
  cachedToken = null;
  tokenPromise = null;
}

function serverEnvValue(parts: string[]): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env?.[parts.join("_")];
}

async function fetchRuntimeClientToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/runtime/client-token", {
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { token?: unknown };
    return typeof body.token === "string" && body.token.trim()
      ? body.token.trim()
      : null;
  } catch {
    return null;
  }
}

export async function getApiToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    if (typeof window === "undefined") {
      // SSR runs in the same Node process as the API; server entrypoints
      // bootstrap the local bearer before route loaders self-fetch.
      const cloudMode = serverEnvValue(["MC", "CLOUD", "MODE"]);
      cachedToken =
        cloudMode === "1" || cloudMode === "true" || cloudMode === "yes"
          ? ""
          : serverEnvValue(["MC", "API", "TOKEN"]) ?? "";
      return rememberApiToken(cachedToken);
    }
    const { getRuntime } = await import("~/lib/runtime");
    const runtime = getRuntime();
    const t = runtime ? await runtime.getApiToken?.() : await fetchRuntimeClientToken();
    return rememberApiToken(t);
  })().then(
    (token) => {
      if (!token) tokenPromise = null;
      return token;
    },
    (err) => {
      tokenPromise = null;
      throw err;
    },
  );
  return tokenPromise;
}

export function getCachedApiToken(): string | null {
  return cachedToken;
}

export function setApiToken(token: string): void {
  cachedToken = token;
  tokenPromise = Promise.resolve(token);
}

export async function prefetchApiToken(): Promise<void> {
  await getApiToken();
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const resolved =
    typeof window === "undefined" && url.startsWith("/")
      ? DEV_SERVER_ORIGIN + url
      : url;
  const incoming = (init?.headers as Record<string, string> | undefined) ?? {};
  const hasAuth = Object.keys(incoming).some((k) => k.toLowerCase() === "authorization");
  const makeHeaders = async () => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...incoming,
    };
    const token = hasAuth ? "" : await getApiToken();
    if (token) headers.authorization = `Bearer ${token}`;
    return { headers, token };
  };

  const initial = await makeHeaders();
  let headers = initial.headers;
  const token = initial.token;
  let res = await fetch(resolved, { ...init, headers });
  if (res.status === 401 && !hasAuth) {
    clearApiTokenCache();
    const retryToken = await getApiToken();
    if (retryToken && retryToken !== token) {
      headers = {
        "content-type": "application/json",
        ...incoming,
        authorization: `Bearer ${retryToken}`,
      };
      res = await fetch(resolved, { ...init, headers });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text ? { error: "Request failed" } : null;
    }
    const message = isApiErrorEnvelope(body) ? body.error : "Request failed";
    throw new ApiError(message, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => req<{ projects: ProjectWithCounts[] }>("/api/projects"),
  getProject: (id: string) => req<{ project: ProjectWithCounts }>(`/api/projects/${id}`),
  createProject: (body: {
    name?: string;
    path?: string;
    icon?: string;
    iconColor?: string;
    imageDataUrl?: string | null;
    groupId?: string | null;
    repoUrl?: string | null;
  }) =>
    req<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createLaunchKitProject: (body: { parentDir: string; projectName: string }) =>
    req<{ project: Project; version: string }>("/api/launch-kit/projects", {
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
  updateTaskStatus: (id: string, body: { status?: TaskStatus; preview?: string; lines?: number }, token?: string | null) =>
    req<{ task: Task }>(`/api/tasks/${id}/status`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
  createTaskInternal: (
    projectId: string,
    body: {
      title: string;
      agent: TaskAgent;
      branch?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
      claudeBareSession?: boolean;
    },
    token?: string | null
  ) =>
    req<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
  updateTask: (
    id: string,
    body: {
      title?: string;
      branch?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
      claudeBareSession?: boolean;
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

  getLicense: () => req<{ license: LicenseState }>("/api/license"),
  validateLicense: (key: string) =>
    req<{ license: LicenseState }>("/api/license/validate", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  removeLicense: () =>
    req<{ license: LicenseState }>("/api/license", { method: "DELETE" }),

  getLaunchKitAccess: () =>
    req<{ hasAccess: boolean }>("/api/launch-kit/access"),

  getSkillsStatus: () =>
    req<{ initializedAt: string | null; dir: string }>("/api/skills"),
  initializeSkills: () =>
    req<{ initializedAt: string; dir: string; fileCount: number }>(
      "/api/skills/initialize",
      { method: "POST" },
    ),

  updateSettings: (
    body: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "accentColor"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "launchAudioDisabled"
      >
    >,
  ) =>
    req<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  regenerateToken: () =>
    req<AppSettings & { apiToken: string }>("/api/settings", {
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
  gitCommit: (projectId: string, opts: { autoStage?: boolean } = {}) =>
    req<CommitResult>(`/api/projects/${projectId}/git/commit`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  gitPush: (projectId: string) =>
    req<PushResult>(`/api/projects/${projectId}/git/push`, { method: "POST" }),
  getUsage: (days: number = 30) =>
    req<UsageSummary>(`/api/usage?days=${days}`),

  deleteProjectFile: (projectId: string, filePath: string) =>
    req<{ ok: true }>(
      `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`,
      { method: "DELETE" },
    ),
};
