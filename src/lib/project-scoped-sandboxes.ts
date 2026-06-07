type HasId = { id: string };
type ScopeProject = { id: string };
type ScopeSandbox = HasId & {
  kind?: string;
  projectId?: string | null;
  remoteProvider?: string | null;
};

function isAwsProjectSandbox(sandbox: ScopeSandbox): boolean {
  return sandbox.kind === "remote-vm" && sandbox.remoteProvider === "aws";
}

/**
 * Sandboxes to show in the header scope switcher for a given screen.
 *
 * Sandboxes are project-scoped: one "belongs to" the project that created it.
 * On a project screen we narrow the switcher to Local + that project's
 * sandboxes; with no current project (e.g. the dashboard) the full list is
 * returned.
 */
export function scopedSandboxesForProject<S extends ScopeSandbox>(
  sandboxes: S[],
  allProjects: ScopeProject[],
  currentProject: ScopeProject | null,
  activeScopeId: string,
): S[] {
  void activeScopeId;
  if (!currentProject) return sandboxes;
  void allProjects;
  const relatedSandboxIds = new Set<string>();
  for (const sandbox of sandboxes) {
    if (isAwsProjectSandbox(sandbox) && sandbox.projectId === currentProject.id) {
      relatedSandboxIds.add(sandbox.id);
    }
  }
  return sandboxes.filter((s) => relatedSandboxIds.has(s.id));
}
