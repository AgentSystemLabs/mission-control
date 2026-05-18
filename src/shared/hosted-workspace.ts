export const HOSTED_WORKSPACE_ROOT = "/home/daytona";

export function hostedWorkspacePath(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${HOSTED_WORKSPACE_ROOT}/${slug || "project"}`;
}
