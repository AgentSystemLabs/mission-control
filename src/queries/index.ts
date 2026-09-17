import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, setApiToken } from "~/lib/api";
import { syncDefaultRuntimeDefaults } from "~/lib/default-model-store";
import { getElectron } from "~/lib/electron";
import {
  readCachedGroups,
  readCachedProjects,
  readCachedSandboxes,
  readCachedSettings,
} from "~/lib/shell-query-cache";
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
  claudeUsageLimits: ["claude-usage-limits"] as const,
  providerUsage: (idsKey: string) => ["provider-usage", idsKey] as const,
  agentAccounts: ["agent-launchers", "accounts"] as const,
  agentLatestVersions: ["agent-launchers", "latest-versions"] as const,
  promptSearch: (query: string) => ["prompt-search", query] as const,
  projectMemory: (projectId: string) => ["projects", projectId, "memory"] as const,
  archivedMemory: (projectId: string) => ["projects", projectId, "memory", "archived"] as const,
  memorySearch: (projectId: string, query: string) =>
    ["projects", projectId, "memory", "search", query] as const,
  scratchPads: (projectId: string) => ["projects", projectId, "scratch-pads"] as const,
  graphStatus: (projectId: string) => ["projects", projectId, "graph", "status"] as const,
  graphSummary: (projectId: string) => ["projects", projectId, "graph", "summary"] as const,
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

// Recall — a project's memories (the Recall panel). Invalidate on `memory:*`
// SSE events (see use-events consumers) so the panel stays live.
export const projectMemoryQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.projectMemory(projectId),
    queryFn: async () => (await api.listMemory(projectId)).memories,
  });

export const useProjectMemory = (projectId: string) =>
  useQuery(projectMemoryQueryOptions(projectId));

// Archived memories (soft-deleted + superseded) for the panel's history view.
// Fetched lazily — only when the Archived filter is opened — via `enabled`.
export const archivedMemoryQueryOptions = (projectId: string, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.archivedMemory(projectId),
    queryFn: async () =>
      (await api.listMemory(projectId, { includeArchived: true })).memories.filter(
        (m) => m.status === "archived",
      ),
    enabled,
  });

export const useArchivedMemory = (projectId: string, enabled: boolean) =>
  useQuery(archivedMemoryQueryOptions(projectId, enabled));

// On-demand FTS search over a project's memories (the Recall panel search box).
// Only runs for a non-empty query; the panel falls back to the full list otherwise.
export const memorySearchQueryOptions = (projectId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.memorySearch(projectId, query),
    queryFn: async () => (await api.searchMemory(projectId, query)).memories,
    enabled: query.trim().length > 0,
  });

export const useMemorySearch = (projectId: string, query: string) =>
  useQuery(memorySearchQueryOptions(projectId, query));

// Scratch pads — the top-bar dropdown's list for the current project, newest
// first. Mutations call api.* imperatively and invalidate this key.
export const scratchPadsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.scratchPads(projectId),
    queryFn: async () => (await api.listScratchPads(projectId)).scratchPads,
  });

export const useScratchPads = (projectId: string | null) =>
  useQuery({ ...scratchPadsQueryOptions(projectId ?? ""), enabled: projectId !== null });

// Recall — code graph status (drives the panel's Code Graph section). Invalidate
// on `graph:indexed` and refresh from `graph:index-progress` SSE (see the panel).
export const graphStatusQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.graphStatus(projectId),
    queryFn: async () => (await api.getGraphStatus(projectId)).status,
  });

export const useCodeGraphStatus = (projectId: string) =>
  useQuery(graphStatusQueryOptions(projectId));

// God-nodes + entry points for the indexed state; only fetched once a graph
// exists (`enabled`) so an un-indexed project makes no summary request.
export const graphSummaryQueryOptions = (projectId: string, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.graphSummary(projectId),
    queryFn: async () => (await api.getGraphSummary(projectId)).summary,
    enabled,
  });

export const useCodeGraphSummary = (projectId: string, enabled: boolean) =>
  useQuery(graphSummaryQueryOptions(projectId, enabled));

export const settingsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const settings = await api.getSettings();
      // Mirror the default runtime into a module cache so commandForTask can append
      // the model flag without prop-drilling settings through the terminal store.
      syncDefaultRuntimeDefaults(settings);
      return settings;
    },
    placeholderData: () => {
      const cached = readCachedSettings();
      if (cached) syncDefaultRuntimeDefaults(cached);
      return cached;
    },
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

// /api/usage waits a short budget for its JSONL sync, so warm responses are
// fully fresh (usage.controller). Only the first-ever cold sync exceeds the
// budget: the server then answers from the current DB and flags `syncing: true`
// while it finishes in the background. We poll on a short interval while that
// flag is set to pick up the converged numbers, then stop. No perpetual polling
// in the steady state, where syncing is always false.
const USAGE_SYNCING_REFETCH_MS = 2_000;

export const usageQueryOptions = (days: number = DEFAULT_USAGE_DAYS) =>
  queryOptions({
    queryKey: queryKeys.usage(days),
    queryFn: async () => api.getUsage(days),
    staleTime: USAGE_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.syncing ? USAGE_SYNCING_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });

// Claude usage limits come from a local file the statusline tap rewrites every
// few seconds (src/shared/statusline-tap.ts), so polling the server is cheap —
// keep the top bar close to live without requiring a manual reload.
const CLAUDE_USAGE_LIMITS_STALE_MS = 20_000;
const CLAUDE_USAGE_LIMITS_REFETCH_MS = 30_000;

export const claudeUsageLimitsQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.claudeUsageLimits,
    queryFn: async () => api.getClaudeUsageLimits(),
    enabled,
    staleTime: CLAUDE_USAGE_LIMITS_STALE_MS,
    refetchInterval: enabled ? CLAUDE_USAGE_LIMITS_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });

const PROVIDER_USAGE_STALE_MS = 20_000;
const PROVIDER_USAGE_REFETCH_MS = 45_000;

export const providerUsageQueryOptions = (
  enabled: boolean,
  providerIds: readonly string[],
) => {
  const idsKey = providerIds.join(",");
  return queryOptions({
    queryKey: queryKeys.providerUsage(idsKey),
    queryFn: async () => api.getProviderUsage(providerIds),
    enabled: enabled && providerIds.length > 0,
    staleTime: PROVIDER_USAGE_STALE_MS,
    refetchInterval: enabled ? PROVIDER_USAGE_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });
};

// Local auth files rarely change while the settings page is open.
const AGENT_ACCOUNTS_STALE_MS = 300_000;
// Aligned with the server-side npm registry cache TTL (1h). Mounting the
// Providers page therefore performs the "check all on open" pass at most
// once an hour; per-row refreshes go through api.getAgentLatestVersions
// with refresh=true.
const AGENT_LATEST_VERSIONS_STALE_MS = 3_600_000;

export const agentAccountsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.agentAccounts,
    queryFn: async () => (await api.getAgentAccounts()).accounts,
    staleTime: AGENT_ACCOUNTS_STALE_MS,
  });

export const agentLatestVersionsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.agentLatestVersions,
    queryFn: async () => (await api.getAgentLatestVersions()).versions,
    staleTime: AGENT_LATEST_VERSIONS_STALE_MS,
  });

const PROMPT_SEARCH_STALE_MS = 5_000;

// `enabled` is caller-controlled so the query only runs while the palette is
// open. The query key includes the (debounced) text so each search is cached.
export const promptSearchQueryOptions = (query: string, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.promptSearch(query),
    queryFn: async () => (await api.searchPrompts(query)).prompts,
    enabled,
    staleTime: PROMPT_SEARCH_STALE_MS,
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
/**
 * Per-row task subscription. Structural sharing keeps an unchanged row's
 * identity stable across list refetches, so a consumer (e.g. a terminal pane
 * header) re-renders only when ITS task changes — not on every task:* event.
 */
export const useTask = (
  projectId: string,
  worktreeId: string | null | undefined,
  scopeId: string | null | undefined,
  taskId: string,
) =>
  useQuery({
    ...tasksQueryOptions(projectId, worktreeId, scopeId),
    select: (tasks) => tasks.find((t) => t.id === taskId),
  });
export const useWorktrees = (projectId: string) => useQuery(worktreesQueryOptions(projectId));
export const useSettings = () => useQuery(settingsQueryOptions());
export const useApiToken = () => useQuery(apiTokenQueryOptions());
export const useUserTerminalsQuery = (
  projectId: string,
  worktreeId?: string | null,
  scopeId?: string | null,
) => useQuery(userTerminalsQueryOptions(projectId, worktreeId, scopeId));
export const useUsage = (days: number = DEFAULT_USAGE_DAYS) =>
  useQuery(usageQueryOptions(days));
export const useClaudeUsageLimits = (enabled: boolean) =>
  useQuery(claudeUsageLimitsQueryOptions(enabled));
export const useProviderUsage = (enabled: boolean, providerIds: readonly string[]) =>
  useQuery(providerUsageQueryOptions(enabled, providerIds));
export const usePromptSearch = (query: string, enabled: boolean) =>
  useQuery(promptSearchQueryOptions(query, enabled));
export const useAgentAccounts = () => useQuery(agentAccountsQueryOptions());
export const useAgentLatestVersions = () => useQuery(agentLatestVersionsQueryOptions());
