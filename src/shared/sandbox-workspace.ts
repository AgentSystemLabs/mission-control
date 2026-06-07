/** Root the remote-VM sandbox clones repos under (in-container workspace dir). */
export const SANDBOX_WORKSPACE_ROOT = "/workspace";

/** Deterministic, filesystem-safe single-segment slug from a project name. */
export function workspaceSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** In-container clone path for a project inside the remote-VM sandbox. */
export function sandboxWorkspacePath(name: string): string {
  return `${SANDBOX_WORKSPACE_ROOT}/${workspaceSlug(name)}`;
}
