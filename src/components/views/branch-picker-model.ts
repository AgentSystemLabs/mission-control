import type { GitBranch } from "~/lib/api";
import type { WorktreeInfo } from "~/shared/worktrees";

/**
 * Split the branch list into plain branches and branches that are checked out
 * in a known worktree. A worktree's branch must never be offered as a checkout
 * target — selecting it repoints the UI at that worktree instead (a checkout
 * would just fail with git's "already used by worktree"/dirty-tree errors).
 */
export function partitionBranches(
  branches: GitBranch[],
  worktrees: WorktreeInfo[],
): { plainBranches: GitBranch[]; worktreeByBranch: Map<string, WorktreeInfo> } {
  const worktreeByBranch = new Map<string, WorktreeInfo>();
  for (const worktree of worktrees) {
    if (worktree.branch && !worktreeByBranch.has(worktree.branch)) {
      worktreeByBranch.set(worktree.branch, worktree);
    }
  }
  return {
    plainBranches: branches.filter((branch) => !worktreeByBranch.has(branch.name)),
    worktreeByBranch,
  };
}
