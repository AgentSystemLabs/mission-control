/** Project id from a router pathname (`/projects/:id/...`), or null off project pages. */
export function projectIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
}
