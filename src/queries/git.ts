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

export const gitKeys = {
  all: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git"] as const,
  status: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "status"] as const,
  branches: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "branches"] as const,
  diff: (projectId: string, worktreeId: string | null | undefined, file: string, staged: boolean) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "diff", file, staged ? "staged" : "unstaged"] as const,
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
