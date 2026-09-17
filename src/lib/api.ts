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
import { MAIN_WORKTREE_ID, type WorktreeInfo } from "~/shared/worktrees";
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
import type { HeaderButtonVisibility } from "~/shared/header-buttons";
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
  /**
   * Wallpaper for the flat theme: an image data URL that replaces the subtle
   * `--bg` ground, or null for none. Only rendered under the flat theme;
   * painted ignores it even while one is stored.
   */
  backgroundImage: string | null;
  /**
   * Paint the subtle grid ground (dots in painted, blueprint grid in flat)
   * behind the dashboard and the project view. Off leaves the bare `--bg`
   * (or the wallpaper) as the ground.
   */
  showBackgroundGrid: boolean;
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
  /** Show the active-group switcher pill in the top bar breadcrumb. */
  showGroupSwitcher: boolean;
  /** Show the group tag (colored dot + group name) in an open project's header. */
  showProjectHeaderGroup: boolean;
  sessionFinishToastEnabled: boolean;
  sessionFinishOsNotificationEnabled: boolean;
  /** Ding when a session-finish or diagram-ready notification arrives. */
  notificationSoundEnabled: boolean;
  launchOverlayEnabled: boolean;
  automaticUpdateDownloadsEnabled: boolean;
  automaticUpdateInstallOnQuitEnabled: boolean;
  /** Git worktrees per project (always on). */
  worktreesEnabled: boolean;
  /** Legacy compatibility field; push-to-talk is always enabled on desktop. */
  voiceControlEnabled: boolean;
  /** Legacy compatibility field; native Claude Code question popups are always enabled. */
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
   * Which discretionary top-bar / project-header buttons are shown. All default
   * on; each action keeps its keyboard shortcut while hidden.
   */
  headerButtons: HeaderButtonVisibility;
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
  /**
   * Harness/model/prompt for the Ship split-button's Create PR action, which
   * opens an AI session to commit/push, sync with upstream, then open a pull
   * request in the browser. Mirrors the Ship trio.
   */
  pullRequestAgent: AiRuntimeHarness;
  pullRequestModel: AiModelId | null;
  pullRequestPrompt: string;
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

type JsonMethod = "POST" | "PATCH" | "PUT" | "DELETE";

/** `req` with a JSON-encoded body (omitted entirely when `body` is undefined). */
function sendJson<T>(method: JsonMethod, url: string, body?: unknown): Promise<T> {
  return req<T>(url, body === undefined ? { method } : { method, body: JSON.stringify(body) });
}

const postJson = <T>(url: string, body?: unknown) => sendJson<T>("POST", url, body);
const patchJson = <T>(url: string, body?: unknown) => sendJson<T>("PATCH", url, body);
const putJson = <T>(url: string, body?: unknown) => sendJson<T>("PUT", url, body);
const deleteJson = <T>(url: string, body?: unknown) => sendJson<T>("DELETE", url, body);

type QueryValue = string | number | boolean | null | undefined;

/**
 * `?a=b&c=d` from the defined entries of `params` (null/undefined are skipped),
 * or "" when nothing is set. Insertion order is preserved.
 */
function queryString(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  listProjects: () => req<{ projects: ProjectWithCounts[] }>("/api/projects"),
  getProject: (id: string) => req<{ project: ProjectWithCounts }>(`/api/projects/${id}`),
  getProjectPathStatus: (id: string, worktreeId?: string | null) =>
    req<{ status: ProjectPathStatus }>(
      `/api/projects/${id}/path-status${queryString({ worktreeId: worktreeId || null })}`,
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
    postJson<{ project: Project }>("/api/projects", body),
  updateProject: (id: string, body: Record<string, unknown>) =>
    patchJson<{ project: Project }>(`/api/projects/${id}`, body),
  updateProjectLaunchUrl: (id: string, launchUrl: string | null) =>
    patchJson<{ project: Project }>(`/api/projects/${id}`, { launchUrl }),
  togglePin: (id: string) =>
    patchJson<{ project: Project }>(`/api/projects/${id}`, { togglePin: true }),
  reorderPinnedProjects: (order: string[]) =>
    patchJson<{ projects: ProjectWithCounts[] }>("/api/projects/pinned-order", { order }),
  deleteProject: async (id: string) => {
    await deleteJson<void>(`/api/projects/${id}`);
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
    postJson<{ sandbox: SandboxPublicView }>("/api/sandboxes/connect", input),
  updateSandbox: (id: string, body: Record<string, unknown>) =>
    patchJson<{ sandbox: SandboxPublicView }>(`/api/sandboxes/${id}`, body),
  deleteSandbox: async (id: string) => {
    await deleteJson<void>(`/api/sandboxes/${id}`);
  },
  revealSandboxApiKey: (id: string) =>
    req<{ apiKey: string }>(`/api/sandboxes/${id}/api-key`),
  setActiveScope: (scopeId: string) =>
    putJson<{ activeScopeId: string }>("/api/sandboxes/active", { scopeId }),
  setSandboxesEnabled: (enabled: boolean) =>
    putJson<{ enabled: boolean }>("/api/sandboxes/enabled", { enabled }),

  listWorktrees: (projectId: string) =>
    req<{ worktrees: WorktreeInfo[] }>(`/api/projects/${projectId}/worktrees`),
  createWorktree: (projectId: string) =>
    postJson<{ worktree: WorktreeInfo; setupCommand: string | null }>(
      `/api/projects/${projectId}/worktrees`,
    ),
  deleteWorktree: async (
    projectId: string,
    worktreeId: string,
    opts: { force?: boolean; stashChanges?: boolean } = {},
  ) => {
    const query = queryString({
      force: opts.force || null,
      stashChanges: opts.stashChanges || null,
    });
    await deleteJson<void>(
      `/api/projects/${projectId}/worktrees/${encodeURIComponent(worktreeId)}${query}`,
      opts,
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
      `/api/projects/${projectId}/memory${queryString({
        includeArchived: opts.includeArchived || null,
      })}`,
    ),
  searchMemory: (projectId: string, query: string, limit?: number) =>
    req<{ memories: MemoryView[] }>(
      `/api/projects/${projectId}/memory/search${queryString({
        q: query || null,
        limit: limit || null,
      })}`,
    ),
  createMemory: (projectId: string, body: Omit<MemoryCreateInput, "projectId">) =>
    postJson<{ memory: MemoryView }>(`/api/projects/${projectId}/memory`, body),
  updateMemory: (memoryId: string, body: MemoryUpdateInput) =>
    patchJson<{ memory: MemoryView }>(`/api/memory/${memoryId}`, body),
  deleteMemory: (memoryId: string, opts: { hard?: boolean } = {}) =>
    deleteJson<void>(`/api/memory/${memoryId}${queryString({ hard: opts.hard || null })}`),
  // Verify a memory against the current code. Applies the verdict server-side
  // (verified / stale / contradicted→supersede) and returns the resulting memory.
  verifyMemory: (memoryId: string) =>
    postJson<{ verdict: MemoryVerifyVerdict; memory: MemoryView }>(
      `/api/memory/${memoryId}/verify`,
    ),
  // The assembled Session Brief for a task (what gets injected). `record: false`
  // previews it without bumping memory usage — for a "view injected brief" panel.
  getTaskBrief: (taskId: string, opts: { record?: boolean } = {}) =>
    req<{ brief: string; memoryIds: string[] }>(
      `/api/tasks/${taskId}/brief${queryString({ record: opts.record === false ? "false" : null })}`,
    ),
  // Preview the brief a new session in this project would get (no usage bump).
  getProjectBrief: (projectId: string) =>
    req<{ brief: string; memoryIds: string[] }>(`/api/projects/${projectId}/brief`),

  // Scratch pads — per-project temporary text buffers.
  listScratchPads: (projectId: string) =>
    req<{ scratchPads: ScratchPadView[] }>(`/api/projects/${projectId}/scratch-pads`),
  createScratchPad: (projectId: string, body: { content?: string } = {}) =>
    postJson<{ scratchPad: ScratchPadView }>(`/api/projects/${projectId}/scratch-pads`, body),
  updateScratchPad: (projectId: string, padId: string, body: { content: string }) =>
    patchJson<{ scratchPad: ScratchPadView }>(
      `/api/projects/${projectId}/scratch-pads/${padId}`,
      body,
    ),
  deleteScratchPad: (projectId: string, padId: string) =>
    deleteJson<void>(`/api/projects/${projectId}/scratch-pads/${padId}`),

  // Recall — code graph.
  getGraphStatus: (projectId: string) =>
    req<{ status: GraphStatus }>(`/api/projects/${projectId}/graph/status`),
  getGraphSummary: (projectId: string) =>
    req<{ summary: GraphSummary }>(`/api/projects/${projectId}/graph/summary`),
  buildGraph: (projectId: string, mode: GraphIndexMode = "full") =>
    postJson<{ status: GraphStatus }>(
      `/api/projects/${projectId}/graph/index${queryString({ mode })}`,
    ),
  cancelGraphBuild: (projectId: string) =>
    postJson<{ status: GraphStatus }>(`/api/projects/${projectId}/graph/index/cancel`),
  searchGraph: (projectId: string, query: string, limit?: number) =>
    req<{ nodes: GraphNodeView[] }>(
      `/api/projects/${projectId}/graph/search${queryString({
        q: query || null,
        limit: limit || null,
      })}`,
    ),
  getGraphNeighbors: (projectId: string, node: string, direction: "in" | "out" | "both" = "both") =>
    req<{ node: GraphNodeView; neighbors: GraphNeighbor[] }>(
      `/api/projects/${projectId}/graph/neighbors${queryString({ node, direction })}`,
    ),

  listGroups: () => req<{ groups: Group[] }>("/api/groups"),
  createGroup: (body: { name: string; color?: string }) =>
    postJson<{ group: Group }>("/api/groups", body),
  updateGroup: (id: string, body: { name?: string; color?: string }) =>
    patchJson<{ group: Group }>(`/api/groups/${id}`, body),
  reorderGroups: (order: string[]) =>
    patchJson<{ groups: Group[] }>("/api/groups/order", { order }),
  deleteGroup: (id: string) =>
    deleteJson<void>(`/api/groups/${id}`),

  listTasks: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    req<{ tasks: Task[] }>(
      `/api/projects/${projectId}/tasks${scopedWorktreeQuery(worktreeId, scopeId)}`,
    ),
  getTask: (id: string) => req<{ task: Task }>(`/api/tasks/${id}`),
  getTaskQuestion: (id: string) =>
    req<{ question: PendingQuestion | null }>(`/api/tasks/${id}/question`),
  archiveTask: (id: string) =>
    postJson<{ task: Task }>(`/api/tasks/${id}/archive`),
  restoreTask: (id: string) =>
    postJson<{ task: Task }>(`/api/tasks/${id}/restore`),
  updateTaskStatus: (
    id: string,
    body: { status?: TaskStatus; preview?: string; lines?: number; prompt?: string },
  ) => postJson<{ task: Task }>(`/api/tasks/${id}/status`, body),
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
    postJson<{ task: Task }>(`/api/projects/${projectId}/tasks`, body),
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
    patchJson<{ task: Task }>(`/api/tasks/${id}`, body),
  deleteTask: async (id: string) => {
    await deleteJson<void>(`/api/tasks/${id}`);
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
    postJson<{ terminal: UserTerminal }>(`/api/projects/${projectId}/user-terminals`, body),
  renameUserTerminal: (id: string, name: string) =>
    patchJson<{ terminal: UserTerminal }>(`/api/user-terminals/${id}`, { name }),
  deleteUserTerminal: (id: string) =>
    deleteJson<void>(`/api/user-terminals/${id}`),

  // Project-less "home" terminals (the dashboard terminals). Returned shaped as
  // UserTerminal (sentinel projectId) so the same terminal store/panel render them.
  listHomeTerminals: (scopeId: string) =>
    req<{ terminals: UserTerminal[] }>(
      `/api/home/user-terminals${queryString({ scopeId })}`,
    ),
  createHomeTerminal: (body: {
    id?: string;
    name?: string;
    cwd?: string | null;
    scopeId: string;
  }) =>
    postJson<{ terminal: UserTerminal }>("/api/home/user-terminals", body),
  renameHomeTerminal: (id: string, name: string) =>
    patchJson<{ terminal: UserTerminal }>(`/api/home/user-terminals/${id}`, { name }),
  deleteHomeTerminal: (id: string) =>
    deleteJson<void>(`/api/home/user-terminals/${id}`),

  getKeybindings: () => req<{ bindings: BindingMap }>("/api/keybindings"),
  setKeybinding: (action: HotkeyAction, binding: Binding) =>
    putJson<{ bindings: BindingMap }>("/api/keybindings", { action, binding }),
  resetKeybinding: (action: HotkeyAction) =>
    deleteJson<{ bindings: BindingMap }>(`/api/keybindings${queryString({ action })}`),
  resetAllKeybindings: () =>
    deleteJson<{ bindings: BindingMap }>("/api/keybindings"),

  getSettings: () => req<AppSettings>("/api/settings"),

  // Every field is writable except `themeChosen`, which the server derives.
  updateSettings: (body: Partial<Omit<AppSettings, "themeChosen">>) =>
    postJson<AppSettings>("/api/settings", body),

  refineMarkdown: (body: MarkdownRefineRequest) =>
    postJson<MarkdownRefineResponse>("/api/markdown/refine", body),

  detectCommitCli: () =>
    req<{ detected: CommitCliDetection }>("/api/commit-cli/detect"),
  listAiRuntimeModels: (agent: AiRuntimeHarness) =>
    req<AiRuntimeModelsResponse>(
      `/api/ai-runtime/models${queryString({ agent })}`,
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
    postJson<GitCheckoutResult>(`/api/projects/${projectId}/git/checkout`, {
      branch,
      create: opts.create,
      worktreeId: opts.worktreeId ?? null,
    }),
  getGitDiff: (projectId: string, file: string, staged: boolean, worktreeId?: string | null) =>
    req<GitDiff>(
      `/api/projects/${projectId}/git/diff${queryString({
        file,
        staged: staged ? "1" : "0",
        worktreeId: worktreeId || null,
      })}`,
    ),
  stageFiles: (projectId: string, files: string[], worktreeId?: string | null) =>
    postJson<{ ok: true }>(`/api/projects/${projectId}/git/stage`, {
      files,
      worktreeId: worktreeId ?? null,
    }),
  unstageFiles: (projectId: string, files: string[], worktreeId?: string | null) =>
    postJson<{ ok: true }>(`/api/projects/${projectId}/git/unstage`, {
      files,
      worktreeId: worktreeId ?? null,
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
    postJson<CommitResult>(`/api/projects/${projectId}/git/commit`, opts),
  gitPush: (projectId: string, worktreeId?: string | null) =>
    postJson<PushResult>(`/api/projects/${projectId}/git/push`, { worktreeId: worktreeId ?? null }),
  gitFetch: (projectId: string, worktreeId?: string | null) =>
    postJson<FetchResult>(`/api/projects/${projectId}/git/fetch`, { worktreeId: worktreeId ?? null }),
  gitPull: (
    projectId: string,
    worktreeId?: string | null,
    mode: "ff-only" | "rebase" | "merge" = "ff-only",
  ) =>
    postJson<PullResult>(`/api/projects/${projectId}/git/pull`, {
      worktreeId: worktreeId ?? null,
      mode,
    }),
  gitCreatePullRequest: (projectId: string, worktreeId?: string | null) =>
    postJson<CreatePullRequestResult>(`/api/projects/${projectId}/git/create-pr`, {
      worktreeId: worktreeId ?? null,
    }),
  getUsage: (days: number = 30) =>
    req<UsageSummary>(`/api/usage${queryString({ days })}`),
  getClaudeUsageLimits: () =>
    req<ClaudeUsageLimits>("/api/claude-usage-limits"),
  getProviderUsage: (providerIds?: readonly string[]) =>
    req<ProviderUsageResponse>(
      `/api/provider-usage${queryString({
        providers: providerIds?.length ? providerIds.join(",") : null,
      })}`,
    ),
  getAgentAccounts: () =>
    req<{ accounts: AgentAccountStatus[] }>("/api/agent-launchers/accounts"),
  getAgentLatestVersions: (agents?: readonly TaskAgent[], opts?: { refresh?: boolean }) =>
    req<{ versions: AgentLatestVersion[] }>(
      `/api/agent-launchers/latest-versions${queryString({
        agents: agents?.length ? agents.join(",") : null,
        refresh: opts?.refresh ? "1" : null,
      })}`,
    ),
  searchPrompts: (query: string, limit?: number) =>
    req<PromptSearchResponse>(
      `/api/prompts${queryString({ q: query, limit: limit || null })}`,
    ),
  createEventsTicket: () =>
    postJson<{ ticket: string; expiresAt: number }>("/api/events/ticket"),
  listDiagrams: (projectId: string) =>
    req<{ diagrams: import("~/shared/diagram").StoredDiagram[] }>(
      `/api/diagrams${queryString({ projectId })}`,
    ),
  getDiagrams: (taskId: string) =>
    req<{ diagrams: import("~/shared/diagram").StoredDiagram[] }>(
      `/api/diagram${queryString({ taskId })}`,
    ),

  deleteProjectFile: (projectId: string, filePath: string, worktreeId?: string | null) =>
    deleteJson<{ ok: true }>(
      `/api/projects/${projectId}/file${queryString({
        path: filePath,
        worktreeId: worktreeId || null,
      })}`,
    ),
};

/** `?worktreeId=` when a worktree was specified (null/"" meaning the main checkout). */
function worktreeQuery(worktreeId?: string | null): string {
  if (worktreeId === undefined) return "";
  return queryString({ worktreeId: worktreeId || MAIN_WORKTREE_ID });
}

function scopedWorktreeQuery(worktreeId?: string | null, scopeId?: string | null): string {
  return queryString({
    worktreeId: worktreeId === undefined ? null : worktreeId || MAIN_WORKTREE_ID,
    scopeId: scopeId || null,
  });
}
