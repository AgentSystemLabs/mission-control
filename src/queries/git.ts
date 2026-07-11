import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "~/lib/api";
import { isPowerSaveActive } from "~/lib/power-save";
import { fetchGitStatus, fetchGitDiff } from "~/lib/project-git";
import type { GitStatus } from "~/shared/git-status";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

// Each status tick spawns several git processes on the server (status,
// branch, ahead-count), so the idle cadence is deliberately lazy — mutations
// (stage/commit/push/checkout) invalidate immediately, and surfaces that
// actively display file-level changes opt into the fast cadence.
const GIT_STATUS_REFETCH_INTERVAL_MS = 15_000;
const GIT_STATUS_FAST_REFETCH_INTERVAL_MS = 3_000;
const GIT_STATUS_POWER_SAVE_REFETCH_INTERVAL_MS = 30_000;

// The status poll only reads local refs, so it can't discover new upstream
// commits on its own. This slower loop runs `git fetch` in the background to
// keep remote-tracking refs fresh — that's what makes GitStatus.behindCount
// (and the branch Sync button) meaningful. Deliberately lazy and focus-gated:
// no point hitting the network for a project the user isn't looking at.
const GIT_UPSTREAM_FETCH_INTERVAL_MS = 60_000;
const GIT_UPSTREAM_FETCH_POWER_SAVE_INTERVAL_MS = 180_000;

export const gitKeys = {
  all: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git"] as const,
  status: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "status"] as const,
  branches: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "branches"] as const,
  diff: (projectId: string, worktreeId: string | null | undefined, file: string, staged: boolean) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "diff", file, staged ? "staged" : "unstaged"] as const,
  // Sibling of `git` (NOT nested under it) so the mutation invalidations that
  // target gitKeys.all — which prefix-match everything under `…/git` — don't
  // force-refetch this side-effecting fetch loop on every commit/push/checkout.
  upstreamFetch: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git-upstream-fetch"] as const,
};

export const gitStatusQueryOptions = (
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean; sandboxRepoPath?: string; fastPoll?: boolean } = {},
) =>
  queryOptions({
    queryKey: gitKeys.status(projectId, worktreeId),
    // Routes to the in-container repo (remoteGit) when sandboxRepoPath is given
    // AND the Terminal runtime is Docker; host HTTP API otherwise.
    queryFn: () => fetchGitStatus(projectId, worktreeId, opts.sandboxRepoPath),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    // With several observers on the same key, TanStack polls at the smallest
    // interval — so an open diff/changes surface wins over the idle route.
    // Evaluated per tick (function form) so battery saver applies live; a
    // surface the user is actively reading keeps the fast cadence regardless.
    refetchInterval: () =>
      opts.fastPoll
        ? GIT_STATUS_FAST_REFETCH_INTERVAL_MS
        : isPowerSaveActive()
          ? GIT_STATUS_POWER_SAVE_REFETCH_INTERVAL_MS
          : GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export const gitBranchesQueryOptions = (
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean } = {},
) =>
  queryOptions({
    queryKey: gitKeys.branches(projectId, worktreeId),
    queryFn: () => api.getGitBranches(projectId, worktreeId),
    enabled: !!projectId && (opts.enabled ?? true),
    staleTime: 5_000,
    retry: 1,
  });

export const gitDiffQueryOptions = (
  projectId: string,
  worktreeId: string | null | undefined,
  file: string | null,
  staged: boolean,
  opts: { enabled?: boolean; sandboxRepoPath?: string } = {},
) =>
  queryOptions({
    queryKey: file
      ? gitKeys.diff(projectId, worktreeId, file, staged)
      : (["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "diff", "__none__"] as const),
    queryFn: () => fetchGitDiff(projectId, file!, staged, worktreeId, opts.sandboxRepoPath),
    enabled: !!file && (opts.enabled ?? true),
  });

export const useGitStatus = (
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean; sandboxRepoPath?: string; fastPoll?: boolean } = {},
) => useQuery(gitStatusQueryOptions(projectId, worktreeId, opts));

export const useGitBranches = (
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean } = {},
) => useQuery(gitBranchesQueryOptions(projectId, worktreeId, opts));

// Background `git fetch` loop that keeps remote-tracking refs current so
// GitStatus.behindCount reflects reality. Modeled as a side-effecting query
// (not a mutation) so it inherits TanStack's focus gating and window-focus
// refetch for free, and so it stays off the MutationCache the Mission Pet
// watches. The fetch is best-effort: offline / no-remote / auth-required
// failures are swallowed on the server (GIT_TERMINAL_PROMPT=0 fails fast),
// leaving the last-known refs in place. After each fetch we invalidate the
// status query so a freshly-appeared "behind" surfaces without waiting for the
// next status tick.
export function useUpstreamFetchPoll(
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean } = {},
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: gitKeys.upstreamFetch(projectId, worktreeId),
    queryFn: async () => {
      try {
        await api.gitFetch(projectId, worktreeId);
      } catch {
        // Best-effort: keep the last-known tracking refs on failure.
      }
      void qc.invalidateQueries({ queryKey: gitKeys.status(projectId, worktreeId) });
      return Date.now();
    },
    enabled: !!projectId && (opts.enabled ?? true),
    // Nothing renders this query's data; it exists purely for the side effect.
    staleTime: Infinity,
    gcTime: 0,
    refetchInterval: () =>
      isPowerSaveActive()
        ? GIT_UPSTREAM_FETCH_POWER_SAVE_INTERVAL_MS
        : GIT_UPSTREAM_FETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export const useGitDiff = (
  projectId: string,
  worktreeId: string | null | undefined,
  file: string | null,
  staged: boolean,
  opts: { enabled?: boolean; sandboxRepoPath?: string } = {},
) => useQuery(gitDiffQueryOptions(projectId, worktreeId, file, staged, opts));

function useInvalidateGit(projectId: string, worktreeId?: string | null) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: gitKeys.all(projectId, worktreeId) });
}

export function useStageFiles(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationFn: (files: string[]) => api.stageFiles(projectId, files, worktreeId),
    onSettled: invalidate,
  });
}

export function useUnstageFiles(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationFn: (files: string[]) => api.unstageFiles(projectId, files, worktreeId),
    onSettled: invalidate,
  });
}

// The "commit" / "push" / "create-pr" mutationKey suffixes below are watched
// by the Mission Pet (src/lib/pet/use-pet-controller.ts) via the MutationCache
// for its shipping reactions — keep them in sync if renamed.
export function useGitCommit(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "commit"] as const,
    mutationFn: (opts?: { autoStage?: boolean; message?: string }) =>
      api.gitCommit(projectId, { ...opts, worktreeId: worktreeId ?? null }),
    onSettled: invalidate,
  });
}

export function useGitPush(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "push"] as const,
    mutationFn: () => api.gitPush(projectId, worktreeId),
    onSettled: invalidate,
  });
}

export function useGitFetch(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "fetch"] as const,
    mutationFn: () => api.gitFetch(projectId, worktreeId),
    onSettled: invalidate,
  });
}

export function useGitPull(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "pull"] as const,
    mutationFn: (mode: "ff-only" | "rebase" | "merge" = "ff-only") =>
      api.gitPull(projectId, worktreeId, mode),
    onSettled: invalidate,
  });
}

export function useGitCreatePullRequest(projectId: string, worktreeId?: string | null) {
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "create-pr"] as const,
    mutationFn: () => api.gitCreatePullRequest(projectId, worktreeId),
  });
}

export function useGitCheckout(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "checkout"] as const,
    mutationFn: (opts: { branch: string; create?: boolean }) =>
      api.gitCheckout(projectId, opts.branch, { create: opts.create, worktreeId: worktreeId ?? null }),
    onSuccess: (result) => {
      qc.setQueryData<GitStatus | undefined>(gitKeys.status(projectId, worktreeId), (current) =>
        current ? { ...current, branch: result.branch } : current
      );
    },
    onSettled: invalidate,
  });
}

export function useDeleteProjectFile(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationFn: (filePath: string) => api.deleteProjectFile(projectId, filePath, worktreeId),
    onSettled: invalidate,
  });
}
