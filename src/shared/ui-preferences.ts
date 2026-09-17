export const GIT_DIFF_CHANGED_FILES_VIEWS = ["list", "tree"] as const;
export type GitDiffChangedFilesView = (typeof GIT_DIFF_CHANGED_FILES_VIEWS)[number];

export const PROJECTS_DASHBOARD_VIEWS = ["cards", "table"] as const;
export type ProjectsDashboardView = (typeof PROJECTS_DASHBOARD_VIEWS)[number];

export const DEFAULT_PROJECTS_DASHBOARD_VIEW: ProjectsDashboardView = "cards";

export const FILE_FINDER_VIEWS = ["list", "tree"] as const;
export type FileFinderView = (typeof FILE_FINDER_VIEWS)[number];

export const DEFAULT_FILE_FINDER_VIEW: FileFinderView = "list";

export const DEFAULT_GIT_DIFF_CHANGED_FILES_VIEW: GitDiffChangedFilesView = "list";
export const DEFAULT_GIT_DIFF_CHANGED_FILES_WIDTH = 300;
export const GIT_DIFF_CHANGED_FILES_WIDTH_MIN = 240;
export const GIT_DIFF_CHANGED_FILES_WIDTH_MAX = 520;

export type SelectedWorktreeByProject = Record<string, string>;

/**
 * The globally active project group — a workspace-like context that scopes
 * the dashboard, the left project rail, and the project picker.
 * Either the sentinel "all" / "ungrouped" or a group id.
 */
export const ACTIVE_GROUP_ALL = "all" as const;
export const ACTIVE_GROUP_UNGROUPED = "ungrouped" as const;
export type ActiveProjectGroup = string;
export const DEFAULT_ACTIVE_PROJECT_GROUP: ActiveProjectGroup = ACTIVE_GROUP_ALL;
export const ACTIVE_PROJECT_GROUP_MAX_LENGTH = 200;

function normalizeEnumValue<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function normalizeGitDiffChangedFilesView(
  value: unknown,
): GitDiffChangedFilesView | null {
  return normalizeEnumValue(value, GIT_DIFF_CHANGED_FILES_VIEWS);
}

export function normalizeProjectsDashboardView(
  value: unknown,
): ProjectsDashboardView | null {
  return normalizeEnumValue(value, PROJECTS_DASHBOARD_VIEWS);
}

export function normalizeFileFinderView(value: unknown): FileFinderView | null {
  return normalizeEnumValue(value, FILE_FINDER_VIEWS);
}

/** Collapsed dashboard section keys — group ids plus "pinned" / "ungrouped". */
export type CollapsedProjectGroups = string[];

export function normalizeCollapsedProjectGroups(value: unknown): CollapsedProjectGroups | null {
  if (!Array.isArray(value)) return null;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export function normalizeActiveProjectGroup(value: unknown): ActiveProjectGroup | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ACTIVE_PROJECT_GROUP_MAX_LENGTH) return null;
  return trimmed;
}

export function normalizeGitDiffChangedFilesWidth(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return null;
  return Math.round(
    Math.max(
      GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
      Math.min(GIT_DIFF_CHANGED_FILES_WIDTH_MAX, raw),
    ),
  );
}

export function normalizeSelectedWorktreeByProject(
  value: unknown,
): SelectedWorktreeByProject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const next: SelectedWorktreeByProject = {};
  for (const [projectId, worktreeId] of Object.entries(value)) {
    if (typeof projectId !== "string" || typeof worktreeId !== "string") continue;
    if (!projectId.trim() || !worktreeId.trim()) continue;
    next[projectId] = worktreeId;
  }
  return next;
}

export function selectedWorktreeMapsEqual(
  a: SelectedWorktreeByProject | null | undefined,
  b: SelectedWorktreeByProject | null | undefined,
): boolean {
  const aa = a ?? {};
  const bb = b ?? {};
  const aKeys = Object.keys(aa);
  const bKeys = Object.keys(bb);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => aa[key] === bb[key]);
}
