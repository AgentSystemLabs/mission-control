import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "~/lib/api";

export const gitKeys = {
  all: (projectId: string) => ["projects", projectId, "git"] as const,
  status: (projectId: string) =>
    ["projects", projectId, "git", "status"] as const,
  diff: (projectId: string, file: string, staged: boolean) =>
    ["projects", projectId, "git", "diff", file, staged ? "staged" : "unstaged"] as const,
};

export const gitStatusQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: gitKeys.status(projectId),
    queryFn: () => api.getGitStatus(projectId),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

export const gitDiffQueryOptions = (
  projectId: string,
  file: string | null,
  staged: boolean,
) =>
  queryOptions({
    queryKey: file
      ? gitKeys.diff(projectId, file, staged)
      : (["projects", projectId, "git", "diff", "__none__"] as const),
    queryFn: () => api.getGitDiff(projectId, file!, staged),
    enabled: !!file,
  });

export const useGitStatus = (projectId: string) =>
  useQuery(gitStatusQueryOptions(projectId));

export const useGitDiff = (
  projectId: string,
  file: string | null,
  staged: boolean,
) => useQuery(gitDiffQueryOptions(projectId, file, staged));

function useInvalidateGit(projectId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: gitKeys.all(projectId) });
}

export function useStageFiles(projectId: string) {
  const invalidate = useInvalidateGit(projectId);
  return useMutation({
    mutationFn: (files: string[]) => api.stageFiles(projectId, files),
    onSettled: invalidate,
  });
}

export function useUnstageFiles(projectId: string) {
  const invalidate = useInvalidateGit(projectId);
  return useMutation({
    mutationFn: (files: string[]) => api.unstageFiles(projectId, files),
    onSettled: invalidate,
  });
}

export function useGitCommit(projectId: string) {
  const invalidate = useInvalidateGit(projectId);
  return useMutation({
    mutationFn: (message: string) => api.gitCommit(projectId, message),
    onSettled: invalidate,
  });
}

export function useGitPush(projectId: string) {
  const invalidate = useInvalidateGit(projectId);
  return useMutation({
    mutationFn: () => api.gitPush(projectId),
    onSettled: invalidate,
  });
}

export function useGenerateCommitMessage(projectId: string) {
  return useMutation({
    mutationFn: () => api.generateCommitMessage(projectId),
  });
}
