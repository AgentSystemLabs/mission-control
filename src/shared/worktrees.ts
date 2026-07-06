import type { TaskStatus } from "./domain";

export const MAIN_WORKTREE_ID = "main";
export const WORKTREE_NAME_RE = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/;

export type WorktreeTaskCounts = Record<TaskStatus, number>;

export type WorktreeInfo = {
  id: string;
  projectId: string;
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
  createdAt: number;
  updatedAt: number;
  /** Non-archived sessions on this worktree, by status. Present on list responses. */
  taskCounts?: WorktreeTaskCounts;
};

export function normalizeWorktreeId(worktreeId?: string | null): string | null {
  return !worktreeId || worktreeId === MAIN_WORKTREE_ID ? null : worktreeId;
}

export function worktreeScopeKey(projectId: string, worktreeId?: string | null): string {
  return `${projectId}:${worktreeId || MAIN_WORKTREE_ID}`;
}
