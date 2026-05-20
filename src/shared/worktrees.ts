export const MAIN_WORKTREE_ID = "main";
export const WORKTREE_NAME_RE = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/;

export type WorktreeInfo = {
  id: string;
  projectId: string;
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
  createdAt: number;
  updatedAt: number;
};

export function normalizeWorktreeId(worktreeId?: string | null): string | null {
  return !worktreeId || worktreeId === MAIN_WORKTREE_ID ? null : worktreeId;
}

export function worktreeScopeKey(projectId: string, worktreeId?: string | null): string {
  return `${projectId}:${worktreeId || MAIN_WORKTREE_ID}`;
}
