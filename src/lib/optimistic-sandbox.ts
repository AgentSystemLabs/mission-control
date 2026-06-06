import type { QueryClient } from "@tanstack/react-query";
import type { api } from "~/lib/api";
import { queryKeys } from "~/queries";
import { LOCAL_SCOPE_ID, type RemoteVmLifecycleStatus, type SandboxPublicView } from "~/shared/sandbox";

export type SandboxesQueryData = Awaited<ReturnType<typeof api.listSandboxes>>;

export type ManagedRemoteDeployProvider = "aws" | "digitalocean" | "railway";

const MANAGED_PROVIDER_LABELS: Record<ManagedRemoteDeployProvider, string> = {
  aws: "AWS EC2",
  digitalocean: "DigitalOcean",
  railway: "Railway",
};

function mergeSandboxPublicView(existing: SandboxPublicView, patch: SandboxPublicView): SandboxPublicView {
  return {
    ...existing,
    ...patch,
    remoteAgentUrl: patch.remoteAgentUrl ?? existing.remoteAgentUrl,
    remoteProvider: patch.remoteProvider ?? existing.remoteProvider,
    remoteProviderName: patch.remoteProviderName ?? existing.remoteProviderName,
    remoteStatus: patch.remoteStatus ?? existing.remoteStatus,
    remoteStatusMessage: patch.remoteStatusMessage ?? existing.remoteStatusMessage,
    remotePublicAddress: patch.remotePublicAddress ?? existing.remotePublicAddress,
    hasApiKey: patch.hasApiKey || existing.hasApiKey,
    hasPairingToken: patch.hasPairingToken || existing.hasPairingToken,
  };
}

export function managedProviderFromDeployInput(
  provider: string | undefined,
): ManagedRemoteDeployProvider | null {
  if (provider === "aws" || provider === "digitalocean" || provider === "railway") return provider;
  return null;
}

export function buildOptimisticRemoteVmSandbox(input: {
  id: string;
  name: string;
  createdAt?: number;
  remoteProvider?: ManagedRemoteDeployProvider | null;
  remoteAgentUrl?: string | null;
  remotePublicAddress?: string | null;
  remoteStatus?: RemoteVmLifecycleStatus | string | null;
  remoteStatusMessage?: string | null;
  hasApiKey?: boolean;
}): SandboxPublicView {
  const now = input.createdAt ?? Date.now();
  const remoteProvider = input.remoteProvider ?? null;
  return {
    id: input.id,
    name: input.name.trim() || "Remote VM",
    kind: "remote-vm",
    color: null,
    imageTag: null,
    dockerfilePath: null,
    buildArgKeys: [],
    hasBuildArgs: false,
    gitAuthMode: "none",
    declaredPorts: [],
    remoteAgentUrl: input.remoteAgentUrl ?? null,
    remoteProvider,
    remoteProviderName: remoteProvider ? MANAGED_PROVIDER_LABELS[remoteProvider] : null,
    remoteStatus: input.remoteStatus ?? (remoteProvider ? "provisioning" : null),
    remoteStatusMessage: input.remoteStatusMessage ?? null,
    remotePublicAddress: input.remotePublicAddress ?? null,
    createdAt: now,
    updatedAt: now,
    hasPairingToken: input.hasApiKey ?? !!remoteProvider,
    hasApiKey: input.hasApiKey ?? !!remoteProvider,
    hasPortMap: false,
  };
}

export function upsertSandboxInCache(
  queryClient: QueryClient,
  sandbox: SandboxPublicView,
  options: { activate?: boolean } = {},
) {
  queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) => {
    const base = current ?? { sandboxes: [], enabled: true, activeScopeId: LOCAL_SCOPE_ID };
    const exists = base.sandboxes.some((item) => item.id === sandbox.id);
    return {
      ...base,
      enabled: true,
      activeScopeId: options.activate ? sandbox.id : base.activeScopeId,
      sandboxes: exists
        ? base.sandboxes.map((item) =>
            item.id === sandbox.id ? mergeSandboxPublicView(item, sandbox) : item,
          )
        : [...base.sandboxes, sandbox],
    };
  });
}

export function restoreSandboxesCache(
  queryClient: QueryClient,
  previous: SandboxesQueryData | undefined,
) {
  if (previous) {
    queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, previous);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.sandboxes });
}

/**
 * Merge a fresh server read with the optimistic rows of in-flight deploys.
 *
 * A managed-remote deploy only writes its sandbox row to SQLite partway through
 * (after the cloud instance is running), and never switches the *server's* active
 * scope until it succeeds. So a plain refetch mid-deploy would drop the optimistic
 * row and reset the active scope back to Local — making the just-created sandbox
 * vanish from the dropdown and closing its logs modal. This keeps any pending
 * sandbox visible (and selected, if it was the optimistic active scope) until the
 * server catches up.
 */
export function mergeServerSandboxesPreservingPending(
  server: SandboxesQueryData,
  pending: SandboxPublicView[],
  clientActiveScopeId: string | null | undefined,
): SandboxesQueryData {
  const pendingById = new Map(pending.map((p) => [p.id, p]));
  const serverIds = new Set(server.sandboxes.map((s) => s.id));
  const sandboxes = [
    // Server is authoritative for rows it already has; pending only fills gaps
    // (e.g. provider label/status) the server hasn't persisted yet.
    ...server.sandboxes.map((s) => {
      const p = pendingById.get(s.id);
      return p ? mergeSandboxPublicView(p, s) : s;
    }),
    // Rows the deploy hasn't persisted yet stay visible as optimistic placeholders.
    ...pending.filter((p) => !serverIds.has(p.id)),
  ];
  const preserveActive =
    clientActiveScopeId != null && pendingById.has(clientActiveScopeId);
  return {
    ...server,
    enabled: server.enabled || pending.length > 0,
    sandboxes,
    activeScopeId: preserveActive ? clientActiveScopeId : server.activeScopeId,
  };
}
