import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "~/lib/api";
import { fetchGitStatus, fetchGitDiff } from "~/lib/project-git";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

const GIT_STATUS_REFETCH_INTERVAL_MS = 3000;

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
  opts: { enabled?: boolean; sandboxRepoPath?: string } = {},
) =>
  queryOptions({
    queryKey: gitKeys.status(projectId, worktreeId),
    // Routes to the in-container repo (remoteGit) when sandboxRepoPath is given
    // AND the Terminal runtime is Docker; host HTTP API otherwise.
    queryFn: () => fetchGitStatus(projectId, worktreeId, opts.sandboxRepoPath),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
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
  opts: { enabled?: boolean; sandboxRepoPath?: string } = {},
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

export function useGitCreatePullRequest(projectId: string, worktreeId?: string | null) {
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "create-pr"] as const,
    mutationFn: () => api.gitCreatePullRequest(projectId, worktreeId),
  });
}

export function useGitCheckout(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationKey: [...gitKeys.all(projectId, worktreeId), "checkout"] as const,
    mutationFn: (opts: { branch: string; create?: boolean }) =>
      api.gitCheckout(projectId, opts.branch, { create: opts.create, worktreeId: worktreeId ?? null }),
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
