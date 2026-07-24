import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { TaskAgent, TaskStatus } from "~/shared/domain";
import type { ProjectPathStatus, ProjectWithCounts } from "~/shared/projects";
import { DEV_SERVER_ORIGIN } from "~/shared/dev-server";
import type {
  CommitResult,
  CreatePullRequestResult,
  FetchResult,
  GitBranch,
  GitBranchesResult,
  GitCheckoutResult,
  GitDiff,
  GitStatus,
  PullResult,
  PushResult,
} from "~/server/services/git";
export type { GitBranch, GitBranchesResult, GitCheckoutResult };
import type { Binding, BindingMap, HotkeyAction } from "~/lib/keybindings/types";
import type { AccentColorId } from "~/lib/accent-colors";
import type { UsageSummary } from "~/shared/token-usage";
import type { ClaudeUsageLimits } from "~/shared/claude-usage-limits";
import type { ProviderUsageId, ProviderUsageResponse } from "~/shared/provider-usage";
import type { AgentLauncherConfig } from "~/shared/agent-launcher-config";
import type { AgentAccountStatus, AgentLatestVersion } from "~/shared/agent-launchers";
import type { PendingQuestion } from "~/shared/agent-questions";
import type { PromptSearchResponse } from "~/shared/prompts";
import type { WorktreeInfo } from "~/shared/worktrees";
import type { CommitCli, CommitCliDetection } from "~/shared/commit-cli";
import type {
  AiModelId,
  AiRuntimeHarness,
  AiRuntimeModelsResponse,
} from "~/shared/ai-runtime-defaults";
import type {
  GitDiffChangedFilesView,
  ProjectsDashboardView,
  SelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import type { TerminalZoomLevel } from "~/shared/terminal-zoom";
import type {
  InterfaceFontScale,
  TerminalFontWeight,
  TerminalLetterSpacing,
  TerminalLineHeight,
} from "~/shared/terminal-appearance";
import type { ThemeStyle } from "~/shared/theme-style";
import type { SurfaceTint } from "~/shared/surface-tint";
import type {
  MarkdownRefineRequest,
  MarkdownRefineResponse,
} from "~/shared/markdown-refine";
import type { SandboxPublicView } from "~/shared/sandbox";
import type {
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryVerifyVerdict,
  MemoryView,
} from "~/shared/project-memory";
import type {
  GraphIndexMode,
  GraphNeighbor,
  GraphNodeView,
  GraphStatus,
  GraphSummary,
} from "~/shared/code-graph";
import type { ScratchPadView } from "~/shared/scratch-pads";
import type { VoiceCommandAliases } from "~/shared/voice-command-aliases";
import type { SessionHeaderButtonVisibility } from "~/shared/session-header-buttons";
import type { PetHomeSide, PetPersistentState } from "~/shared/pet";
import { pruneStoredSessionFinishNotifications } from "~/lib/session-notification-store";
import { HTTP_NO_CONTENT } from "~/shared/http-status";

// The api bearer token is intentionally NOT part of this HTTP-derived shape.
// Renderer code obtains it through the Electron IPC channel `settings:getToken`
// (see queries/index.ts:apiTokenQueryOptions); the IPC handler pushes the value
// into `setApiToken` below so every fetch in this module attaches it.
export type AppSettings = {
  agentSystemBannerDisabled: boolean;
  accentColor: AccentColorId;
  /** Which chrome to render: painted (pixel art, dark-only) or flat (clean,
   *  Ember character, supports dark/light). */
  themeStyle: ThemeStyle;
  /** How much accent to mix into surface tokens (off / subtle / vivid). */
  surfaceTint: SurfaceTint;
  /** Derived server-side: true when themeStyle renders clean CSS chrome. */
  minimalTheme: boolean;
  /**
   * Derived server-side, read-only: false only on a fresh install where no
   * theme setting was ever saved. Gates the first-launch theme picker.
   */
  themeChosen: boolean;
  mouseGradientDisabled: boolean;
  /** Reduce energy use on battery: freeze decorative animations, slow idle polls. */
  batterySaverEnabled: boolean;
  /** Spellcheck in text fields (Electron). Off frees ~15-20 MB while composing. */
  spellcheckEnabled: boolean;
  /** Show the active group name badge in the project rail header. */
  showGroupBadge: boolean;
  sessionFinishToastEnabled: boolean;
  sessionFinishOsNotificationEnabled: boolean;
  /** Ding when a session-finish or diagram-ready notification arrives. */
  notificationSoundEnabled: boolean;
  launchOverlayEnabled: boolean;
  automaticUpdateDownloadsEnabled: boolean;
  automaticUpdateInstallOnQuitEnabled: boolean;
  /** Git worktrees per project (always on). */
  worktreesEnabled: boolean;
  /** Experimental: push-to-talk voice control (off by default). */
  voiceControlEnabled: boolean;
  /** Beta: native popup for Claude Code AskUserQuestion menus (on by default). */
  questionOverlayEnabled: boolean;
  gitDiffChangedFilesView: GitDiffChangedFilesView | null;
  gitDiffChangedFilesWidth: number | null;
  /** Projects dashboard layout — cards (default) or table. */
  projectsDashboardView: ProjectsDashboardView | null;
  /**
   * Globally active project group scoping the dashboard, left rail, and
   * project picker: "ungrouped", a group id, or null for "all projects".
   */
  activeProjectGroup: string | null;
  /** Collapsed dashboard section keys — group ids plus "pinned"/"ungrouped". */
  collapsedProjectGroups: string[] | null;
  selectedWorktreeByProject: SelectedWorktreeByProject | null;
  /**
   * Which CLI generates Ship's commit message. `null` means "not set yet" —
   * the server auto-detects and seeds it on the first ship attempt.
   */
  commitCli: CommitCli | null;
  /** Default terminal text zoom (-2 … +2). Per-pane overrides live in localStorage. */
  terminalZoomLevel: TerminalZoomLevel;
  /** Terminal font face; `null` = the active theme's bundled face. */
  terminalFontFamily: string | null;
  /** CSS weight for regular terminal text (100–900). */
  terminalFontWeight: TerminalFontWeight;
  /** CSS weight for bold terminal text (100–900). */
  terminalFontWeightBold: TerminalFontWeight;
  /** Terminal row height multiplier (1.0–1.8; 1.0 keeps ANSI art flush). */
  terminalLineHeight: TerminalLineHeight;
  /** Extra px between terminal characters (0–3). */
  terminalLetterSpacing: TerminalLetterSpacing;
  /** UI font face; `null` = the active theme's UI face. */
  interfaceFontFamily: string | null;
  /** Window zoom factor scaling all UI elements (1 = 100%). */
  interfaceFontScale: InterfaceFontScale;
  /**
   * Which discretionary session-pane header buttons are shown. Zoom is hidden
   * by default (it's driven by keyboard shortcuts); the rest default on.
   */
  sessionHeaderButtons: SessionHeaderButtonVisibility;
  /**
   * Default harness/model for voice-started agents when the command doesn't name one.
   * `null` means "not set" — don't pass a model flag, so the CLI uses its own default.
   */
  defaultAgent: AiRuntimeHarness;
  defaultModel: AiModelId | null;
  /**
   * Model used by the markdown-preview "Refine" action (rewrites a .md file from
   * reviewer annotations). `null` means "not set" — the selected CLI uses its own
   * default. Independent from `defaultModel` (voice agents).
   */
  annotationAgent: AiRuntimeHarness;
  annotationModel: AiModelId | null;
  /**
   * Harness/model/prompt for the Ship button, which opens an AI session to push
   * and sync with remote (pull/rebase/conflict fix when needed).
   */
  shipAgent: AiRuntimeHarness;
  shipModel: AiModelId | null;
  shipPrompt: string;
  /**
   * Harness/model/prompt for the branch Sync split-button, which opens an AI
   * session to pull upstream changes into the current branch (stash/commit,
   * conflict resolution, stash-pop). Mirrors the Ship trio.
   */
  syncAgent: AiRuntimeHarness;
  syncModel: AiModelId | null;
  syncPrompt: string;
  /** User-defined phrases that map to built-in voice commands. */
  voiceCommandAliases: VoiceCommandAliases;
  /**
   * Show Claude Code's live session (5h) + weekly usage limits in the top bar.
   * Off by default — enabling it makes the app fetch usage from Anthropic using
   * the user's Claude login. The two `show*` flags toggle each window.
   * Kept for backward compatibility; multi-provider uses `providerUsage*`.
   */
  claudeUsageLimitsEnabled: boolean;
  claudeUsageLimitsShowSession: boolean;
  claudeUsageLimitsShowWeekly: boolean;
  /**
   * Multi-provider usage (CodexBar fork): master toggle + which providers appear
   * in the compact top-bar control. Off by default so the chrome stays quiet.
   */
  providerUsageEnabled: boolean;
  providerUsageIds: ProviderUsageId[];
  /** New Session picker: agent display order + hidden agents (never all hidden). */
  agentLauncherConfig: AgentLauncherConfig;
  /**
   * Recall (project memory) controls. `recallEnabled` is the experimental
   * master switch — it ships off by default (opt in from Settings). When off
   * the server reports every behavioral flag below as false (stored values are
   * preserved for re-enable) and the UI hides Recall entirely. Auto-capture
   * distills memories when a session finishes; the
   * engine settings pick which CLI the LLM shells out to (mirroring session
   * creation). Disabling the engine degrades to deterministic FTS + heuristic
   * ranking with no CLI round-trip.
   */
  recallEnabled: boolean;
  recallAutoCaptureEnabled: boolean;
  recallEngineEnabled: boolean;
  recallEngineHarness: AiRuntimeHarness;
  recallEngineModel: AiModelId | null;
  /** Whether an agent session may write memories back to its project. */
  recallAgentWriteEnabled: boolean;
  /** Whether a fresh session gets the Session Brief injected on start. */
  recallInjectBriefEnabled: boolean;
  /** Whether the brief includes the code-graph "Architecture at a glance" section. */
  recallCodeGraphEnabled: boolean;
  /** Whether each turn gets relevant memories + graph hits injected proactively. */
  recallProactiveRecallEnabled: boolean;
  /** Whether the "Learned N memories from this session" toast fires after auto-capture. */
  recallLearnedToastEnabled: boolean;
  /**
   * Mission Pet — the ambient corner companion that reacts to real agent
   * activity. `petState` holds its persistent identity (name, XP, personality);
   * null until the pet first hydrates (or after a reset).
   */
  petEnabled: boolean;
  petMessagesEnabled: boolean;
  petSoundsEnabled: boolean;
  /**
   * Opt-in (default false): broadcast this machine's pet to others working on
   * the same git repo and show theirs. No WebSocket connects unless this is on.
   */
  petMultiplayerEnabled: boolean;
  /** Bottom corner the pet homes in (default right). */
  petHomeSide: PetHomeSide;
  petState: PetPersistentState | null;
};

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
  if (res.status === HTTP_NO_CONTENT) return undefined as T;
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
    sandboxId?: string | null;
    savedAgent?: Project["savedAgent"] | null;
    rememberAgentSettings?: boolean;
    defaultGridView?: boolean;
    pinned?: boolean;
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
  reorderPinnedProjects: (order: string[]) =>
    req<{ projects: ProjectWithCounts[] }>("/api/projects/pinned-order", {
      method: "PATCH",
      body: JSON.stringify({ order }),
    }),
  deleteProject: async (id: string) => {
    await req<void>(`/api/projects/${id}`, { method: "DELETE" });
    pruneStoredSessionFinishNotifications({ type: "project", projectId: id });
  },

  // Sandboxes (isolated execution scopes). Desktop-only; on web this returns a
  // disabled, empty state.
  listSandboxes: () =>
    req<{ sandboxes: SandboxPublicView[]; enabled: boolean; activeScopeId: string }>("/api/sandboxes"),
  connectSandbox: (input: {
    name: string;
    agentUrl: string;
    apiKey: string;
    agentCa?: string | null;
  }) =>
    req<{ sandbox: SandboxPublicView }>("/api/sandboxes/connect", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateSandbox: (id: string, body: Record<string, unknown>) =>
    req<{ sandbox: SandboxPublicView }>(`/api/sandboxes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSandbox: async (id: string) => {
    await req<void>(`/api/sandboxes/${id}`, { method: "DELETE" });
  },
  revealSandboxApiKey: (id: string) =>
    req<{ apiKey: string }>(`/api/sandboxes/${id}/api-key`),
  setActiveScope: (scopeId: string) =>
    req<{ activeScopeId: string }>("/api/sandboxes/active", {
      method: "PUT",
      body: JSON.stringify({ scopeId }),
    }),
  setSandboxesEnabled: (enabled: boolean) =>
    req<{ enabled: boolean }>("/api/sandboxes/enabled", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),

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
    opts: { force?: boolean; stashChanges?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.force) params.set("force", "true");
    if (opts.stashChanges) params.set("stashChanges", "true");
    const queryString = params.toString();
    const query = queryString ? `?${queryString}` : "";
    await req<void>(
      `/api/projects/${projectId}/worktrees/${encodeURIComponent(worktreeId)}${query}`,
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

  // Recall — project memory.
  listMemory: (projectId: string, opts: { includeArchived?: boolean } = {}) =>
    req<{ memories: MemoryView[] }>(
      `/api/projects/${projectId}/memory${opts.includeArchived ? "?includeArchived=true" : ""}`,
    ),
  searchMemory: (projectId: string, query: string, limit?: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return req<{ memories: MemoryView[] }>(
      `/api/projects/${projectId}/memory/search${qs ? `?${qs}` : ""}`,
    );
  },
  createMemory: (projectId: string, body: Omit<MemoryCreateInput, "projectId">) =>
    req<{ memory: MemoryView }>(`/api/projects/${projectId}/memory`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMemory: (memoryId: string, body: MemoryUpdateInput) =>
    req<{ memory: MemoryView }>(`/api/memory/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMemory: (memoryId: string, opts: { hard?: boolean } = {}) =>
    req<void>(`/api/memory/${memoryId}${opts.hard ? "?hard=true" : ""}`, { method: "DELETE" }),
  // Verify a memory against the current code. Applies the verdict server-side
  // (verified / stale / contradicted→supersede) and returns the resulting memory.
  verifyMemory: (memoryId: string) =>
    req<{ verdict: MemoryVerifyVerdict; memory: MemoryView }>(
      `/api/memory/${memoryId}/verify`,
      { method: "POST" },
    ),
  // The assembled Session Brief for a task (what gets injected). `record: false`
  // previews it without bumping memory usage — for a "view injected brief" panel.
  getTaskBrief: (taskId: string, opts: { record?: boolean } = {}) =>
    req<{ brief: string; memoryIds: string[] }>(
      `/api/tasks/${taskId}/brief${opts.record === false ? "?record=false" : ""}`,
    ),
  // Preview the brief a new session in this project would get (no usage bump).
  getProjectBrief: (projectId: string) =>
    req<{ brief: string; memoryIds: string[] }>(`/api/projects/${projectId}/brief`),

  // Scratch pads — per-project temporary text buffers.
  listScratchPads: (projectId: string) =>
    req<{ scratchPads: ScratchPadView[] }>(`/api/projects/${projectId}/scratch-pads`),
  createScratchPad: (projectId: string, body: { content?: string } = {}) =>
    req<{ scratchPad: ScratchPadView }>(`/api/projects/${projectId}/scratch-pads`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateScratchPad: (projectId: string, padId: string, body: { content: string }) =>
    req<{ scratchPad: ScratchPadView }>(`/api/projects/${projectId}/scratch-pads/${padId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteScratchPad: (projectId: string, padId: string) =>
    req<void>(`/api/projects/${projectId}/scratch-pads/${padId}`, { method: "DELETE" }),

  // Recall — code graph.
  getGraphStatus: (projectId: string) =>
    req<{ status: GraphStatus }>(`/api/projects/${projectId}/graph/status`),
  getGraphSummary: (projectId: string) =>
    req<{ summary: GraphSummary }>(`/api/projects/${projectId}/graph/summary`),
  buildGraph: (projectId: string, mode: GraphIndexMode = "full") =>
    req<{ status: GraphStatus }>(`/api/projects/${projectId}/graph/index?mode=${mode}`, {
      method: "POST",
    }),
  cancelGraphBuild: (projectId: string) =>
    req<{ status: GraphStatus }>(`/api/projects/${projectId}/graph/index/cancel`, {
      method: "POST",
    }),
  searchGraph: (projectId: string, query: string, limit?: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return req<{ nodes: GraphNodeView[] }>(
      `/api/projects/${projectId}/graph/search${qs ? `?${qs}` : ""}`,
    );
  },
  getGraphNeighbors: (projectId: string, node: string, direction: "in" | "out" | "both" = "both") =>
    req<{ node: GraphNodeView; neighbors: GraphNeighbor[] }>(
      `/api/projects/${projectId}/graph/neighbors?node=${encodeURIComponent(node)}&direction=${direction}`,
    ),

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
  reorderGroups: (order: string[]) =>
    req<{ groups: Group[] }>("/api/groups/order", {
      method: "PATCH",
      body: JSON.stringify({ order }),
    }),
  deleteGroup: (id: string) =>
    req<void>(`/api/groups/${id}`, { method: "DELETE" }),

  listTasks: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    req<{ tasks: Task[] }>(
      `/api/projects/${projectId}/tasks${scopedWorktreeQuery(worktreeId, scopeId)}`,
    ),
  getTask: (id: string) => req<{ task: Task }>(`/api/tasks/${id}`),
  getTaskQuestion: (id: string) =>
    req<{ question: PendingQuestion | null }>(`/api/tasks/${id}/question`),
  archiveTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/archive`, { method: "POST" }),
  restoreTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/restore`, { method: "POST" }),
  updateTaskStatus: (id: string, body: { status?: TaskStatus; preview?: string; lines?: number; prompt?: string }) =>
    req<{ task: Task }>(`/api/tasks/${id}/status`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createTaskInternal: (
    projectId: string,
    body: {
      id?: string;
      title: string;
      agent: TaskAgent;
      branch?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
      claudeBareSession?: boolean;
      worktreeId?: string | null;
      scopeId?: string | null;
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
      pinned?: boolean;
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

  listUserTerminals: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    req<{ terminals: UserTerminal[] }>(
      `/api/projects/${projectId}/user-terminals${scopedWorktreeQuery(worktreeId, scopeId)}`,
    ),
  createUserTerminal: (
    projectId: string,
    body: {
      id?: string;
      name?: string;
      cwd?: string | null;
      startCommand?: string | null;
      worktreeId?: string | null;
      scopeId?: string | null;
    },
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

  // Project-less "home" terminals (the dashboard terminals). Returned shaped as
  // UserTerminal (sentinel projectId) so the same terminal store/panel render them.
  listHomeTerminals: (scopeId: string) =>
    req<{ terminals: UserTerminal[] }>(
      `/api/home/user-terminals?scopeId=${encodeURIComponent(scopeId)}`,
    ),
  createHomeTerminal: (body: {
    id?: string;
    name?: string;
    cwd?: string | null;
    scopeId: string;
  }) =>
    req<{ terminal: UserTerminal }>("/api/home/user-terminals", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renameHomeTerminal: (id: string, name: string) =>
    req<{ terminal: UserTerminal }>(`/api/home/user-terminals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteHomeTerminal: (id: string) =>
    req<void>(`/api/home/user-terminals/${id}`, { method: "DELETE" }),

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

  updateSettings: (
    body: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "accentColor"
        | "themeStyle"
        | "surfaceTint"
        | "minimalTheme"
        | "mouseGradientDisabled"
        | "batterySaverEnabled"
        | "spellcheckEnabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "notificationSoundEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
        | "worktreesEnabled"
        | "voiceControlEnabled"
        | "questionOverlayEnabled"
        | "gitDiffChangedFilesView"
        | "gitDiffChangedFilesWidth"
        | "projectsDashboardView"
        | "activeProjectGroup"
        | "collapsedProjectGroups"
        | "selectedWorktreeByProject"
        | "commitCli"
        | "terminalZoomLevel"
        | "terminalFontFamily"
        | "terminalFontWeight"
        | "terminalFontWeightBold"
        | "terminalLineHeight"
        | "terminalLetterSpacing"
        | "interfaceFontFamily"
        | "interfaceFontScale"
        | "sessionHeaderButtons"
        | "defaultAgent"
        | "defaultModel"
        | "annotationAgent"
        | "annotationModel"
        | "shipAgent"
        | "shipModel"
        | "shipPrompt"
        | "syncAgent"
        | "syncModel"
        | "syncPrompt"
        | "voiceCommandAliases"
        | "claudeUsageLimitsEnabled"
        | "claudeUsageLimitsShowSession"
        | "claudeUsageLimitsShowWeekly"
        | "providerUsageEnabled"
        | "providerUsageIds"
        | "agentLauncherConfig"
        | "recallEnabled"
        | "recallAutoCaptureEnabled"
        | "recallEngineEnabled"
        | "recallEngineHarness"
        | "recallEngineModel"
        | "recallAgentWriteEnabled"
        | "recallInjectBriefEnabled"
        | "recallCodeGraphEnabled"
        | "recallProactiveRecallEnabled"
        | "recallLearnedToastEnabled"
        | "petEnabled"
        | "petMessagesEnabled"
        | "petSoundsEnabled"
        | "petMultiplayerEnabled"
        | "petHomeSide"
        | "petState"
      >
    >,
  ) =>
    req<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  refineMarkdown: (body: MarkdownRefineRequest) =>
    req<MarkdownRefineResponse>("/api/markdown/refine", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  detectCommitCli: () =>
    req<{ detected: CommitCliDetection }>("/api/commit-cli/detect"),
  listAiRuntimeModels: (agent: AiRuntimeHarness) =>
    req<AiRuntimeModelsResponse>(
      `/api/ai-runtime/models?agent=${encodeURIComponent(agent)}`,
    ),

  getGitStatus: (projectId: string, worktreeId?: string | null) =>
    req<GitStatus>(`/api/projects/${projectId}/git/status${worktreeQuery(worktreeId)}`),
  getGitBranches: (projectId: string, worktreeId?: string | null) =>
    req<GitBranchesResult>(`/api/projects/${projectId}/git/branches${worktreeQuery(worktreeId)}`),
  gitCheckout: (
    projectId: string,
    branch: string,
    opts: { create?: boolean; worktreeId?: string | null } = {},
  ) =>
    req<GitCheckoutResult>(`/api/projects/${projectId}/git/checkout`, {
      method: "POST",
      body: JSON.stringify({
        branch,
        create: opts.create,
        worktreeId: opts.worktreeId ?? null,
      }),
    }),
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
  gitFetch: (projectId: string, worktreeId?: string | null) =>
    req<FetchResult>(`/api/projects/${projectId}/git/fetch`, {
      method: "POST",
      body: JSON.stringify({ worktreeId: worktreeId ?? null }),
    }),
  gitPull: (
    projectId: string,
    worktreeId?: string | null,
    mode: "ff-only" | "rebase" | "merge" = "ff-only",
  ) =>
    req<PullResult>(`/api/projects/${projectId}/git/pull`, {
      method: "POST",
      body: JSON.stringify({ worktreeId: worktreeId ?? null, mode }),
    }),
  gitCreatePullRequest: (projectId: string, worktreeId?: string | null) =>
    req<CreatePullRequestResult>(`/api/projects/${projectId}/git/create-pr`, {
      method: "POST",
      body: JSON.stringify({ worktreeId: worktreeId ?? null }),
    }),
  getUsage: (days: number = 30) =>
    req<UsageSummary>(`/api/usage?days=${days}`),
  getClaudeUsageLimits: () =>
    req<ClaudeUsageLimits>("/api/claude-usage-limits"),
  getProviderUsage: (providerIds?: readonly string[]) => {
    const q =
      providerIds && providerIds.length > 0
        ? `?providers=${encodeURIComponent(providerIds.join(","))}`
        : "";
    return req<ProviderUsageResponse>(`/api/provider-usage${q}`);
  },
  getAgentAccounts: () =>
    req<{ accounts: AgentAccountStatus[] }>("/api/agent-launchers/accounts"),
  getAgentLatestVersions: (agents?: readonly TaskAgent[], opts?: { refresh?: boolean }) => {
    const params = new URLSearchParams();
    if (agents && agents.length > 0) params.set("agents", agents.join(","));
    if (opts?.refresh) params.set("refresh", "1");
    const q = params.size > 0 ? `?${params.toString()}` : "";
    return req<{ versions: AgentLatestVersion[] }>(`/api/agent-launchers/latest-versions${q}`);
  },
  searchPrompts: (query: string, limit?: number) =>
    req<PromptSearchResponse>(
      `/api/prompts?q=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ""}`,
    ),
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

function scopedWorktreeQuery(worktreeId?: string | null, scopeId?: string | null): string {
  const params = new URLSearchParams();
  if (worktreeId !== undefined) params.set("worktreeId", worktreeId || "main");
  if (scopeId) params.set("scopeId", scopeId);
  const query = params.toString();
  return query ? `?${query}` : "";
}
