import {
  normalizeGitDiffChangedFilesView,
  normalizeSelectedWorktreeByProject,
  type GitDiffChangedFilesView,
  type SelectedWorktreeByProject,
} from "~/shared/ui-preferences";

export const GIT_DIFF_CHANGED_FILES_VIEW_STORAGE_KEY = "mc:gitDiffChangedFilesView";
export const GIT_DIFF_CHANGED_FILES_WIDTH_STORAGE_KEY = "mc:gitDiffChangedFilesWidth";
export const SELECTED_WORKTREE_BY_PROJECT_STORAGE_KEY = "mc.selectedWorktreeByProject";

export function readCachedGitDiffChangedFilesView(): GitDiffChangedFilesView | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeGitDiffChangedFilesView(
      window.localStorage.getItem(GIT_DIFF_CHANGED_FILES_VIEW_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function writeCachedGitDiffChangedFilesView(view: GitDiffChangedFilesView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GIT_DIFF_CHANGED_FILES_VIEW_STORAGE_KEY, view);
  } catch {
    /* localStorage unavailable */
  }
}

export function readCachedSelectedWorktreeByProject(): SelectedWorktreeByProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SELECTED_WORKTREE_BY_PROJECT_STORAGE_KEY);
    return raw ? normalizeSelectedWorktreeByProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCachedSelectedWorktreeByProject(
  selectedWorktreeByProject: SelectedWorktreeByProject,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SELECTED_WORKTREE_BY_PROJECT_STORAGE_KEY,
      JSON.stringify(selectedWorktreeByProject),
    );
  } catch {
    /* localStorage unavailable */
  }
}
