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
 * A user-connected remote sandbox (registered via "Connect sandbox" with an
 * agent URL, not provisioned by a managed cloud provider). Provider-less rows
 * are the manual marker — managed rows always persist `remote_config.provider`.
 */
export function isManualRemoteSandbox(sandbox: ScopeSandbox): boolean {
  return sandbox.kind === "remote-vm" && !sandbox.remoteProvider;
}

/**
 * Whether a sandbox is usable as the runtime scope for a given project.
 * Managed (AWS) sandboxes belong to the project that created them; manually
 * connected sandboxes are a machine, not a per-project resource, so they are
 * usable from every project.
 */
export function sandboxUsableForProject(
  sandbox: ScopeSandbox,
  projectId: string,
): boolean {
  if (isManualRemoteSandbox(sandbox)) return true;
  return isAwsProjectSandbox(sandbox) && sandbox.projectId === projectId;
}

/**
 * Sandboxes to show in the header scope switcher for a given screen.
 *
 * Managed sandboxes are project-scoped: one "belongs to" the project that
 * created it, so a project screen narrows the switcher to Local + that
 * project's sandboxes. Manually connected sandboxes appear on every project.
 * With no current project (e.g. the dashboard) the full list is returned.
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
  return sandboxes.filter((s) => sandboxUsableForProject(s, currentProject.id));
}
