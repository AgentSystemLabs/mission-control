import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { ProjectPathStatus, ProjectWithCounts } from "~/shared/projects";
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
import type { Entitlements } from "~/shared/entitlements";
import type { WorktreeInfo } from "~/shared/worktrees";
import type { CommitCli, CommitCliDetection } from "~/shared/commit-cli";
import type {
  GitDiffChangedFilesView,
  SelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import { getClientRuntime } from "~/lib/runtime";
import { MISSION_CONTROL_RUNTIME_HEADER } from "~/shared/runtime";
import { pruneStoredSessionFinishNotifications } from "~/lib/session-notification-store";

// The api bearer token is intentionally NOT part of this HTTP-derived shape.
// Renderer code obtains it through the Electron IPC channel `settings:getToken`
// (see queries/index.ts:apiTokenQueryOptions); the IPC handler pushes the value
// into `setApiToken` below so every fetch in this module attaches it.
export type AppSettings = {
  agentSystemBannerDisabled: boolean;
  accentColor: AccentColorId;
  minimalTheme: boolean;
  mouseGradientDisabled: boolean;
  sessionFinishToastEnabled: boolean;
  sessionFinishOsNotificationEnabled: boolean;
  launchOverlayEnabled: boolean;
  automaticUpdateDownloadsEnabled: boolean;
  automaticUpdateInstallOnQuitEnabled: boolean;
  /** Beta: git worktrees per project (off by default). */
  worktreesEnabled: boolean;
  gitDiffChangedFilesView: GitDiffChangedFilesView | null;
  gitDiffChangedFilesWidth: number | null;
  selectedWorktreeByProject: SelectedWorktreeByProject | null;
  /**
   * Which CLI generates Ship's commit message. `null` means "not set yet" —
   * the server auto-detects and seeds it on the first ship attempt.
   */
  commitCli: CommitCli | null;
};

type RemotePtyCreateBody = {
  cwd: string;
  command: string;
  agent?: string;
  cols?: number;
  rows?: number;
} & (
  | { taskId: string; projectId?: never }
  | { projectId: string; taskId?: never }
);

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Module-level bearer cache. Populated by `apiTokenQueryOptions.queryFn` (see
// src/queries/index.ts) so every `req<T>` below can attach the token without
// awaiting an IPC round-trip per call. `resolveApiToken` falls back to a server
// bootstrap on SSR and lazy IPC in the renderer when nothing has primed the
// cache yet (test code, edge timing).
let cachedApiToken: string | null = null;
let pendingApiToken: Promise<string | null> | null = null;
let serverApiTokenResolver: (() => string | null) | null = null;

export function setApiToken(token: string | null): void {
  cachedApiToken = token;
  pendingApiToken = null;
}

export function setServerApiTokenResolver(resolver: (() => string | null) | null): void {
  serverApiTokenResolver = resolver;
}

export async function resolveApiToken(): Promise<string | null> {
  if (cachedApiToken) return cachedApiToken;
  if (import.meta.env.SSR) {
    try {
      return serverApiTokenResolver?.() ?? null;
    } catch {
      return null;
    }
  }
  if (pendingApiToken) return pendingApiToken;
  pendingApiToken = (async () => {
    try {
      const { getElectron } = await import("./electron");
      const electron = getElectron();
      if (!electron) return null;
      const token = await electron.settings.getToken();
      cachedApiToken = token;
      return token;
    } catch {
      return null;
    } finally {
      pendingApiToken = null;
    }
  })();
  return pendingApiToken;
}

function hasAuthHeader(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has("authorization");
  if (Array.isArray(headers)) {
    return headers.some(([k]) => k.toLowerCase() === "authorization");
  }
  return Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Node's fetch (used during TanStack Start SSR) rejects relative URLs.
  // In the browser the page origin is implicit; on the server, prepend the
  // Vite dev origin so loader prefetches resolve correctly.
  const resolved =
    typeof window === "undefined" && url.startsWith("/")
      ? DEV_SERVER_ORIGIN + url
      : url;
  const baseHeaders: Record<string, string> = { "content-type": "application/json" };
  if (!import.meta.env.SSR) {
    baseHeaders[MISSION_CONTROL_RUNTIME_HEADER] = getClientRuntime();
  }
  if (!hasAuthHeader(init?.headers)) {
    const token = await resolveApiToken();
    if (token) baseHeaders.authorization = `Bearer ${token}`;
  }
  const res = await fetch(resolved, {
    ...init,
    headers: {
      ...baseHeaders,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON — keep as text
    }
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as any).error === "string"
        ? (body as any).error
        : null) ?? `${res.status} ${res.statusText}: ${text}`;
    throw new ApiError(message, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => req<{ projects: ProjectWithCounts[] }>("/api/projects"),
  getProject: (id: string) => req<{ project: ProjectWithCounts }>(`/api/projects/${id}`),
  getProjectPathStatus: (id: string, worktreeId?: string | null) =>
    req<{ status: ProjectPathStatus }>(
      `/api/projects/${id}/path-status${worktreeId ? `?worktreeId=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  createProject: (body: {
    name?: string;
    path: string;
    githubUrl?: string;
    icon?: string;
    iconColor?: string;
    groupId?: string | null;
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
  deleteProject: async (id: string) => {
    await req<void>(`/api/projects/${id}`, { method: "DELETE" });
    pruneStoredSessionFinishNotifications({ type: "project", projectId: id });
  },

  listWorktrees: (projectId: string) =>
    req<{ worktrees: WorktreeInfo[] }>(`/api/projects/${projectId}/worktrees`),
  createWorktree: (projectId: string) =>
    req<{ worktree: WorktreeInfo; setupCommand: string | null }>(
      `/api/projects/${projectId}/worktrees`,
      { method: "POST" },
    ),
  deleteWorktree: async (
    projectId: string,
    worktreeId: string,
    opts: { force?: boolean } = {},
  ) => {
    await req<void>(
      `/api/projects/${projectId}/worktrees/${encodeURIComponent(worktreeId)}`,
      {
        method: "DELETE",
        body: JSON.stringify(opts),
      },
    );
    pruneStoredSessionFinishNotifications({
      type: "worktree",
      projectId,
      worktreeId,
    });
  },

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

  listTasks: (projectId: string, worktreeId?: string | null) =>
    req<{ tasks: Task[] }>(
      `/api/projects/${projectId}/tasks${worktreeQuery(worktreeId)}`,
    ),
  archiveTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/archive`, { method: "POST" }),
  restoreTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/restore`, { method: "POST" }),
  updateTaskStatus: (id: string, body: { status?: TaskStatus; preview?: string; lines?: number }) =>
    req<{ task: Task }>(`/api/tasks/${id}/status`, {
      method: "POST",
      body: JSON.stringify(body),
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
      worktreeId?: string | null;
    },
  ) =>
    req<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
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
  deleteTask: async (id: string) => {
    await req<void>(`/api/tasks/${id}`, { method: "DELETE" });
    pruneStoredSessionFinishNotifications({ type: "task", taskId: id });
  },

  listUserTerminals: (projectId: string, worktreeId?: string | null) =>
    req<{ terminals: UserTerminal[] }>(
      `/api/projects/${projectId}/user-terminals${worktreeQuery(worktreeId)}`,
    ),
  createUserTerminal: (
    projectId: string,
    body: { name?: string; cwd?: string | null; startCommand?: string | null; worktreeId?: string | null }
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
  getEntitlements: () => req<{ entitlements: Entitlements }>("/api/entitlements"),
  createRemotePty: (body: RemotePtyCreateBody) =>
    req<{ ptyId: string }>("/api/remote-pty", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  writeRemotePty: (ptyId: string, data: string) =>
    req<{ ok: true }>(`/api/remote-pty/${encodeURIComponent(ptyId)}/write`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }),
  resizeRemotePty: (ptyId: string, cols: number, rows: number) =>
    req<{ ok: true }>(`/api/remote-pty/${encodeURIComponent(ptyId)}/resize`, {
      method: "POST",
      body: JSON.stringify({ cols, rows }),
    }),
  killRemotePty: (ptyId: string) =>
    req<{ ok: true }>(`/api/remote-pty/${encodeURIComponent(ptyId)}/kill`, {
      method: "POST",
    }),
  replayRemotePty: (ptyId: string, opts: { afterSeq?: number; beforeSeq?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.afterSeq !== undefined) params.set("afterSeq", String(opts.afterSeq));
    if (opts.beforeSeq !== undefined) params.set("beforeSeq", String(opts.beforeSeq));
    const suffix = params.size ? `?${params.toString()}` : "";
    return req<{ data: string; nextSeq: number }>(
      `/api/remote-pty/${encodeURIComponent(ptyId)}/replay${suffix}`,
    );
  },
  createRemotePtyTicket: (ptyId: string) =>
    req<{ ticket: string; expiresAt: number }>(
      `/api/remote-pty/${encodeURIComponent(ptyId)}/ticket`,
      { method: "POST" },
    ),
  validateLicense: (key: string) =>
    req<{ license: LicenseState }>("/api/license/validate", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  removeLicense: () =>
    req<{ license: LicenseState }>("/api/license", { method: "DELETE" }),

  getLaunchKitAccess: () =>
    req<{ hasAccess: boolean }>("/api/launch-kit/access"),

  updateSettings: (
    body: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "accentColor"
        | "minimalTheme"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
        | "worktreesEnabled"
        | "gitDiffChangedFilesView"
        | "gitDiffChangedFilesWidth"
        | "selectedWorktreeByProject"
        | "commitCli"
      >
    >,
  ) =>
    req<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  detectCommitCli: () =>
    req<{ detected: CommitCliDetection }>("/api/commit-cli/detect"),

  getGitStatus: (projectId: string, worktreeId?: string | null) =>
    req<GitStatus>(`/api/projects/${projectId}/git/status${worktreeQuery(worktreeId)}`),
  getGitDiff: (projectId: string, file: string, staged: boolean, worktreeId?: string | null) =>
    req<GitDiff>(
      `/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}&staged=${staged ? "1" : "0"}${worktreeId ? `&worktreeId=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  stageFiles: (projectId: string, files: string[], worktreeId?: string | null) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/stage`, {
      method: "POST",
      body: JSON.stringify({ files, worktreeId: worktreeId ?? null }),
    }),
  unstageFiles: (projectId: string, files: string[], worktreeId?: string | null) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/unstage`, {
      method: "POST",
      body: JSON.stringify({ files, worktreeId: worktreeId ?? null }),
    }),
  gitCommit: (
    projectId: string,
    opts: {
      autoStage?: boolean;
      worktreeId?: string | null;
      /**
       * When supplied, the server skips CLI generation entirely and commits
       * with this literal message. Used by the ship-failed dialog's manual
       * recovery path.
       */
      message?: string;
    } = {},
  ) =>
    req<CommitResult>(`/api/projects/${projectId}/git/commit`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  gitPush: (projectId: string, worktreeId?: string | null) =>
    req<PushResult>(`/api/projects/${projectId}/git/push`, {
      method: "POST",
      body: JSON.stringify({ worktreeId: worktreeId ?? null }),
    }),
  getUsage: (days: number = 30) =>
    req<UsageSummary>(`/api/usage?days=${days}`),
  createEventsTicket: () =>
    req<{ ticket: string; expiresAt: number }>("/api/events/ticket", {
      method: "POST",
    }),
  listDiagrams: (projectId: string) =>
    req<{ diagrams: import("~/shared/diagram").StoredDiagram[] }>(
      `/api/diagrams?projectId=${encodeURIComponent(projectId)}`,
    ),
  getDiagrams: (taskId: string) =>
    req<{ diagrams: import("~/shared/diagram").StoredDiagram[] }>(
      `/api/diagram?taskId=${encodeURIComponent(taskId)}`,
    ),

  deleteProjectFile: (projectId: string, filePath: string, worktreeId?: string | null) =>
    req<{ ok: true }>(
      `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktreeId=${encodeURIComponent(worktreeId)}` : ""}`,
      { method: "DELETE" },
    ),
};

function worktreeQuery(worktreeId?: string | null): string {
  if (worktreeId === undefined) return "";
  return `?worktreeId=${encodeURIComponent(worktreeId || "main")}`;
}
