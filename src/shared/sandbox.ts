// Shared sandbox vocabulary used by the client, server, and Electron main.
// A "sandbox" is an isolated execution environment that can be attached to a
// project as an alternate runtime.
// See docs/multi-sandbox-plan.md.

/** Execution backend for a sandbox. */
export const SANDBOX_KINDS = ["remote-vm"] as const;

export type SandboxKind = (typeof SANDBOX_KINDS)[number];

export type SandboxGitAuthMode = "none" | "copy-host" | "generate";

/**
 * How an AWS sandbox instance gets its tooling. "golden" launches from the
 * maintained public AMI (fast boot); "full-install" runs the setup script on a
 * clean Ubuntu base. "golden" falls back to "full-install" automatically when no
 * AMI exists for the target region/arch, so it is always a safe default.
 */
export type SandboxImageStrategy = "golden" | "full-install";

export type RemoteVmLifecycleStatus =
  | "provisioning"
  | "ready"
  | "provisioning_failed"
  | "pausing"
  | "paused"
  | "pause_failed"
  | "resuming"
  | "resume_failed"
  | "destroy_failed"
  /** The cloud instance no longer exists (terminated/deleted out-of-band). Not
   *  resumable — the only recovery is to remove the local record or switch to Local. */
  | "missing";

export type SandboxRemoteConfig = {
  /** WebSocket endpoint for a user-managed remote agent. Stored without secrets. */
  agentUrl: string;
  /**
   * Managed cloud VMs can expose the raw ws:// agent port behind a cloud
   * firewall rule because there is no domain/certificate at creation time.
   * Manual remote URLs still require wss:// unless they are loopback.
   */
  allowPlaintextPublic?: boolean;
  /** Managed cloud VMs terminate TLS on-box with a self-signed cert (`wss://`). */
  tls?: boolean;
  /**
   * PEM of the VM's self-signed cert, captured at deploy time. The desktop
   * client pins this exact cert instead of trusting a public CA. Not a secret.
   */
  agentCa?: string | null;
  /** SHA-256 fingerprint of `agentCa` (informational / future pin-by-hash). */
  agentCertSha256?: string | null;
  /**
   * Managed provider metadata. Present only for Mission Control-provisioned
   * remotes. Only "aws" is provisioned today; the `string` fallback keeps reads
   * type-safe for legacy rows persisted under removed providers.
   */
  provider?: "aws" | string;
  providerId?: string | null;
  providerName?: string | null;
  status?: RemoteVmLifecycleStatus | string | null;
  statusMessage?: string | null;
  publicIp?: string | null;
  region?: string | null;
  size?: string | null;
  image?: string | null;
  localPort?: number | null;
  agentPort?: number | null;
  cloud?: Record<string, unknown>;
  /** Project this sandbox was created from (project-scoped create flow). */
  projectId?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

/** Launch-image metadata stamped at managed AWS deploy time (from `remote_config.cloud`). */
export type SandboxImageProvenance = {
  /** EC2 AMI id used at launch (`remote_config.image`). */
  imageId: string | null;
  /** True when the instance launched from the maintained golden AMI. */
  goldenImage: boolean | null;
  /** Golden AMI manifest version (e.g. `2026.06.06-1`). */
  imageManifestVersion: string | null;
  /** Sandbox agent version baked into the golden AMI at build time. */
  imageAgentVersion: string | null;
};

export function parseSandboxImageProvenance(
  remote: SandboxRemoteConfig | null | undefined,
): SandboxImageProvenance {
  const cloud =
    remote?.cloud && typeof remote.cloud === "object" && !Array.isArray(remote.cloud)
      ? (remote.cloud as Record<string, unknown>)
      : null;
  return {
    imageId: typeof remote?.image === "string" ? remote.image : null,
    goldenImage: cloud && typeof cloud.goldenImage === "boolean" ? cloud.goldenImage : null,
    imageManifestVersion:
      cloud && typeof cloud.imageManifestVersion === "string" ? cloud.imageManifestVersion : null,
    imageAgentVersion:
      cloud && typeof cloud.imageAgentVersion === "string" ? cloud.imageAgentVersion : null,
  };
}

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
  remoteProvider: string | null;
  remoteProviderName: string | null;
  remoteStatus: RemoteVmLifecycleStatus | string | null;
  remoteStatusMessage: string | null;
  remotePublicAddress: string | null;
  /** Present when the sandbox was created from a project screen. */
  projectId: string | null;
  /** EC2 AMI id when this sandbox was launched from a managed AWS deploy. */
  remoteImageId: string | null;
  /** True when the sandbox launched from the maintained golden AMI. */
  remoteGoldenImage: boolean | null;
  /** Golden AMI manifest version when `remoteGoldenImage` is true. */
  remoteImageManifestVersion: string | null;
  /** Agent version baked into the golden AMI at deploy time. */
  remoteImageAgentVersion: string | null;
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

export function normalizeRemoteAgentUrl(
  value: string,
  opts: { allowPlaintextPublic?: boolean } = {},
): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isPlaintext = url.protocol === "http:" || url.protocol === "ws:";
    if (isPlaintext && !isLoopbackHost(url.hostname) && !opts.allowPlaintextPublic) return null;
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
 * A selected non-local scope is a concrete sandbox id. The header dropdown
 * selects exactly one ScopeId at a time.
 */
export const LOCAL_SCOPE_ID = "local";

/** A selectable scope: the Local sentinel, or a concrete sandbox id. */
export type ScopeId = string;

export function isLocalScope(scope: ScopeId | null | undefined): boolean {
  return !scope || scope === LOCAL_SCOPE_ID;
}

/** Coerce a blank/missing scope id to the Local sentinel. */
export function normalizeScopeId(scopeId: string | null | undefined): string {
  return scopeId?.trim() || LOCAL_SCOPE_ID;
}

export function scopeToSandboxId(scope: ScopeId | null | undefined): string | null {
  return isLocalScope(scope) ? null : (scope as string);
}

export type SandboxScopeState = {
  enabled: boolean;
  activeScopeId: string;
};

/** Project sandboxes do not hide or duplicate the project list. */
export function filterProjectsByScope<T>(
  projects: T[],
  sandboxState: SandboxScopeState | null | undefined,
): T[] {
  void sandboxState;
  return projects;
}
