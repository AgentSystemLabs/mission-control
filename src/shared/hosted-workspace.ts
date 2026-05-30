export const HOSTED_WORKSPACE_ROOT = "/home/workspace";
/** Root the Docker sandbox runner clones repos under (named-volume mount). */
export const SANDBOX_WORKSPACE_ROOT = "/workspace";
const LEGACY_HOSTED_WORKSPACE_ROOTS = ["/home/daytona"] as const;

/** Deterministic, filesystem-safe single-segment slug from a project name. */
export function workspaceSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

export function hostedWorkspacePath(name: string): string {
  return `${HOSTED_WORKSPACE_ROOT}/${workspaceSlug(name)}`;
}

/** In-container clone path for a project in the Docker sandbox (US-4.1). */
export function sandboxWorkspacePath(name: string): string {
  return `${SANDBOX_WORKSPACE_ROOT}/${workspaceSlug(name)}`;
}

export function normalizeHostedWorkspacePath(path: string | null | undefined): string | null {
  if (!path) return null;
  for (const legacyRoot of LEGACY_HOSTED_WORKSPACE_ROOTS) {
    if (path === legacyRoot) return HOSTED_WORKSPACE_ROOT;
    if (path.startsWith(`${legacyRoot}/`)) {
      return `${HOSTED_WORKSPACE_ROOT}${path.slice(legacyRoot.length)}`;
    }
  }
  return path;
}
