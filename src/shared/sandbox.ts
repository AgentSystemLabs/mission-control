// Shared sandbox vocabulary used by the client, server, and Electron main.
// A "sandbox" is an isolated execution environment that owns its own projects.
// See docs/multi-sandbox-plan.md.

/** Execution backend for a sandbox. */
export const SANDBOX_KINDS = ["local-docker", "remote-vm"] as const;

export type SandboxKind = (typeof SANDBOX_KINDS)[number];

export type SandboxGitAuthMode = "none" | "copy-host" | "generate";

export type SandboxRemoteConfig = {
  /** WebSocket endpoint for a user-managed mc-agent. Stored without secrets. */
  agentUrl: string;
};

export type SandboxPublicView = {
  id: string;
  name: string;
  kind: SandboxKind;
  color: string | null;
  imageTag: string | null;
  dockerfilePath: string | null;
  buildArgKeys: string[];
  hasBuildArgs: boolean;
  gitAuthMode: SandboxGitAuthMode;
  declaredPorts: number[];
  remoteAgentUrl: string | null;
  createdAt: number;
  updatedAt: number;
  hasPairingToken: boolean;
  hasApiKey: boolean;
  hasPortMap: boolean;
};

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "::1" || host === "127.0.0.1";
}

export function normalizeRemoteAgentUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isPlaintext = url.protocol === "http:" || url.protocol === "ws:";
    if (isPlaintext && !isLoopbackHost(url.hostname)) return null;
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (url.username || url.password || url.search) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Sentinel scope meaning "the host machine" — the implicit, undeletable default.
 * Projects in the Local scope have `sandboxId = null`; everything else is a
 * sandbox id. The header dropdown selects exactly one ScopeId at a time.
 */
export const LOCAL_SCOPE_ID = "local";

/** A selectable scope: the Local sentinel, or a concrete sandbox id. */
export type ScopeId = string;

export function isLocalScope(scope: ScopeId | null | undefined): boolean {
  return !scope || scope === LOCAL_SCOPE_ID;
}

/** Map a selected ScopeId to the value stored on `projects.sandboxId`. */
export function scopeToSandboxId(scope: ScopeId | null | undefined): string | null {
  return isLocalScope(scope) ? null : (scope as string);
}

/** Map a project's stored `sandboxId` back to a ScopeId for the UI. */
export function sandboxIdToScope(sandboxId: string | null | undefined): ScopeId {
  return sandboxId ?? LOCAL_SCOPE_ID;
}

export type SandboxScopeState = {
  enabled: boolean;
  activeScopeId: string;
};

/** Keep only projects that belong to the active scope when sandboxes are enabled. */
export function filterProjectsByScope<T extends { sandboxId: string | null }>(
  projects: T[],
  sandboxState: SandboxScopeState | null | undefined,
): T[] {
  if (!sandboxState?.enabled) return projects;
  const activeScopeId = sandboxState.activeScopeId ?? LOCAL_SCOPE_ID;
  return projects.filter((p) => sandboxIdToScope(p.sandboxId) === activeScopeId);
}
