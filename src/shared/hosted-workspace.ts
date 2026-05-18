export const HOSTED_WORKSPACE_ROOT = "/home/workspace";
const LEGACY_HOSTED_WORKSPACE_ROOTS = ["/home/daytona"] as const;

export function hostedWorkspacePath(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${HOSTED_WORKSPACE_ROOT}/${slug || "project"}`;
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
