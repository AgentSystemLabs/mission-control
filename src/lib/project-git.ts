// Routes git status/diff reads to the host repo (HTTP API) or the in-container
// clone (remoteGit RPC) by runtime. Only status + diff are agent-supported;
// mutations (stage/commit/push) stay on the HTTP path. Default-preserved: with
// no sandboxRepoPath, every call is exactly the prior `api.*` behavior.
import { api } from "~/lib/api";
import { isSandboxRuntimeActive } from "~/lib/project-fs";
import type { GitStatus, GitDiff } from "~/shared/git-status";

export async function fetchGitStatus(
  projectId: string,
  worktreeId: string | null | undefined,
  sandboxRepoPath?: string,
): Promise<GitStatus> {
  if (sandboxRepoPath && window.electronAPI && (await isSandboxRuntimeActive())) {
    const status = await window.electronAPI.remoteGit.status(sandboxRepoPath);
    // The sandbox agent's git RPC predates behindCount and doesn't compute it,
    // so the wire object is missing the field its GitStatus type claims. Backfill
    // null so the type matches runtime reality (Sync is local-only regardless).
    return { ...status, behindCount: status.behindCount ?? null };
  }
  return api.getGitStatus(projectId, worktreeId);
}

export async function fetchGitDiff(
  projectId: string,
  file: string,
  staged: boolean,
  worktreeId: string | null | undefined,
  sandboxRepoPath?: string,
): Promise<GitDiff> {
  if (sandboxRepoPath && window.electronAPI && (await isSandboxRuntimeActive())) {
    return window.electronAPI.remoteGit.diff(sandboxRepoPath, file, staged);
  }
  return api.getGitDiff(projectId, file, staged, worktreeId);
}
