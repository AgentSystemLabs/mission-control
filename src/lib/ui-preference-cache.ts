import {
  normalizeFileFinderView,
  normalizeGitDiffChangedFilesView,
  normalizeProjectsDashboardView,
  normalizeSelectedWorktreeByProject,
  type FileFinderView,
  type GitDiffChangedFilesView,
  type ProjectsDashboardView,
  type SelectedWorktreeByProject,
} from "~/shared/ui-preferences";

export const GIT_DIFF_CHANGED_FILES_VIEW_STORAGE_KEY = "mc:gitDiffChangedFilesView";
export const GIT_DIFF_CHANGED_FILES_WIDTH_STORAGE_KEY = "mc:gitDiffChangedFilesWidth";
export const PROJECTS_DASHBOARD_VIEW_STORAGE_KEY = "mc:projectsDashboardView";
export const FILE_FINDER_VIEW_STORAGE_KEY = "mc:fileFinderView";
export const SELECTED_WORKTREE_BY_PROJECT_STORAGE_KEY = "mc.selectedWorktreeByProject";

/**
 * A string-valued UI preference persisted in localStorage, normalized on read.
 * SSR-safe: `read` returns null and `write` no-ops outside the browser, and
 * both swallow storage errors.
 */
function makeStringPreference<T extends string>(
  key: string,
  normalize: (raw: string | null) => T | null,
): { read: () => T | null; write: (view: T) => void } {
  return {
    read() {
      if (typeof window === "undefined") return null;
      try {
        return normalize(window.localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    write(view: T) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, view);
      } catch {
        /* localStorage unavailable */
      }
    },
  };
}

const gitDiffChangedFilesView = makeStringPreference<GitDiffChangedFilesView>(
  GIT_DIFF_CHANGED_FILES_VIEW_STORAGE_KEY,
  normalizeGitDiffChangedFilesView,
);
export const readCachedGitDiffChangedFilesView = gitDiffChangedFilesView.read;
export const writeCachedGitDiffChangedFilesView = gitDiffChangedFilesView.write;

const projectsDashboardView = makeStringPreference<ProjectsDashboardView>(
  PROJECTS_DASHBOARD_VIEW_STORAGE_KEY,
  normalizeProjectsDashboardView,
);
export const readCachedProjectsDashboardView = projectsDashboardView.read;
export const writeCachedProjectsDashboardView = projectsDashboardView.write;

const fileFinderView = makeStringPreference<FileFinderView>(
  FILE_FINDER_VIEW_STORAGE_KEY,
  normalizeFileFinderView,
);
export const readCachedFileFinderView = fileFinderView.read;
export const writeCachedFileFinderView = fileFinderView.write;

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
