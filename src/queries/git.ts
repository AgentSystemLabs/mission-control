import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "~/lib/api";
import { isWebDaytonaRuntime } from "~/lib/runtime";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

const GIT_STATUS_REFETCH_INTERVAL_MS = 3000;

export const gitKeys = {
  all: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git"] as const,
  status: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "status"] as const,
  diff: (projectId: string, worktreeId: string | null | undefined, file: string, staged: boolean) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "diff", file, staged ? "staged" : "unstaged"] as const,
};

export const gitStatusQueryOptions = (
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean } = {},
) =>
  queryOptions({
    queryKey: gitKeys.status(projectId, worktreeId),
    queryFn: () => api.getGitStatus(projectId, worktreeId),
    enabled: !isWebDaytonaRuntime() && (opts.enabled ?? true),
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export const gitDiffQueryOptions = (
  projectId: string,
  worktreeId: string | null | undefined,
  file: string | null,
  staged: boolean,
  opts: { enabled?: boolean } = {},
) =>
  queryOptions({
    queryKey: file
      ? gitKeys.diff(projectId, worktreeId, file, staged)
      : (["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "git", "diff", "__none__"] as const),
    queryFn: () => api.getGitDiff(projectId, file!, staged, worktreeId),
    enabled: !!file && !isWebDaytonaRuntime() && (opts.enabled ?? true),
  });

export const useGitStatus = (
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean } = {},
) => useQuery(gitStatusQueryOptions(projectId, worktreeId, opts));

export const useGitDiff = (
  projectId: string,
  worktreeId: string | null | undefined,
  file: string | null,
  staged: boolean,
  opts: { enabled?: boolean } = {},
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

export function useDeleteProjectFile(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateGit(projectId, worktreeId);
  return useMutation({
    mutationFn: (filePath: string) => api.deleteProjectFile(projectId, filePath, worktreeId),
    onSettled: invalidate,
  });
}
