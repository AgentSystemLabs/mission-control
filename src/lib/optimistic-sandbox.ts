import type { QueryClient } from "@tanstack/react-query";
import type { api } from "~/lib/api";
import { queryKeys } from "~/queries";
import type { RemoteVmDeployInput, RemoteVmDeployJobSnapshot } from "~/shared/electron-contract";
import { LOCAL_SCOPE_ID, type RemoteVmLifecycleStatus, type SandboxPublicView } from "~/shared/sandbox";

export type SandboxesQueryData = Awaited<ReturnType<typeof api.listSandboxes>>;

export type ManagedRemoteDeployProvider = "aws";

const MANAGED_PROVIDER_LABELS: Record<ManagedRemoteDeployProvider, string> = {
  aws: "AWS EC2",
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
    projectId: patch.projectId ?? existing.projectId,
    remoteImageId: patch.remoteImageId ?? existing.remoteImageId,
    remoteGoldenImage: patch.remoteGoldenImage ?? existing.remoteGoldenImage,
    remoteImageManifestVersion:
      patch.remoteImageManifestVersion ?? existing.remoteImageManifestVersion,
    remoteImageAgentVersion: patch.remoteImageAgentVersion ?? existing.remoteImageAgentVersion,
    hasApiKey: patch.hasApiKey || existing.hasApiKey,
    hasPairingToken: patch.hasPairingToken || existing.hasPairingToken,
  };
}

export function managedProviderFromDeployInput(
  provider: string | undefined,
): ManagedRemoteDeployProvider | null {
  return provider === "aws" ? "aws" : null;
}

function projectIdFromDeployInput(input: RemoteVmDeployInput): string | null {
  const projectId = input.projectId?.trim();
  return projectId || null;
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
  projectId?: string | null;
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
    projectId: input.projectId ?? null,
    remoteImageId: null,
    remoteGoldenImage: null,
    remoteImageManifestVersion: null,
    remoteImageAgentVersion: null,
    createdAt: now,
    updatedAt: now,
    hasPairingToken: input.hasApiKey ?? !!remoteProvider,
    hasApiKey: input.hasApiKey ?? !!remoteProvider,
    hasPortMap: false,
  };
}

export function buildOptimisticRemoteVmSandboxFromDeployJob(
  job: RemoteVmDeployJobSnapshot,
  existing?: SandboxPublicView | null,
): SandboxPublicView | null {
  const sandboxId = job.result?.sandboxId ?? job.input.sandboxId ?? null;
  if (!sandboxId) return null;
  const managedProvider = managedProviderFromDeployInput(job.input.provider);
  return buildOptimisticRemoteVmSandbox({
    id: sandboxId,
    name: job.result?.name ?? job.input.name,
    createdAt: job.createdAt,
    remoteProvider: managedProvider,
    remoteAgentUrl: job.result?.agentUrl ?? existing?.remoteAgentUrl,
    remotePublicAddress: job.result?.publicIp ?? existing?.remotePublicAddress,
    remoteStatus: managedProvider ? "provisioning" : existing?.remoteStatus,
    remoteStatusMessage: existing?.remoteStatusMessage,
    hasApiKey: managedProvider ? true : existing?.hasApiKey,
    projectId: projectIdFromDeployInput(job.input) ?? existing?.projectId,
  });
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

export function removeSandboxFromCache(
  queryClient: QueryClient,
  sandboxId: string,
  options: { switchActiveToLocal?: boolean } = {},
) {
  queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) => {
    if (!current) return current;
    const sandboxes = current.sandboxes.filter((sandbox) => sandbox.id !== sandboxId);
    const switchActive =
      options.switchActiveToLocal && current.activeScopeId === sandboxId;
    return {
      ...current,
      activeScopeId: switchActive ? LOCAL_SCOPE_ID : current.activeScopeId,
      sandboxes,
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

export function updateSandboxRemoteStatusInCache(
  queryClient: QueryClient,
  sandboxId: string,
  patch: {
    remoteStatus: RemoteVmLifecycleStatus | string | null;
    remoteStatusMessage?: string | null;
    remotePublicAddress?: string | null;
  },
  options: { switchActiveToLocal?: boolean } = {},
) {
  queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) => {
    if (!current) return current;
    let found = false;
    const sandboxes = current.sandboxes.map((sandbox) => {
      if (sandbox.id !== sandboxId) return sandbox;
      found = true;
      return {
        ...sandbox,
        remoteStatus: patch.remoteStatus,
        remoteStatusMessage:
          patch.remoteStatusMessage !== undefined
            ? patch.remoteStatusMessage
            : sandbox.remoteStatusMessage,
        remotePublicAddress:
          patch.remotePublicAddress !== undefined
            ? patch.remotePublicAddress
            : sandbox.remotePublicAddress,
        updatedAt: Date.now(),
      };
    });
    if (!found) return current;
    return {
      ...current,
      activeScopeId:
        options.switchActiveToLocal && current.activeScopeId === sandboxId
          ? LOCAL_SCOPE_ID
          : current.activeScopeId,
      sandboxes,
    };
  });
}

export function markSandboxStoppingInCache(
  queryClient: QueryClient,
  sandboxId: string,
  options: { switchActiveToLocal?: boolean } = {},
) {
  updateSandboxRemoteStatusInCache(
    queryClient,
    sandboxId,
    { remoteStatus: "pausing", remoteStatusMessage: null },
    options,
  );
}

export function markSandboxStoppedInCache(queryClient: QueryClient, sandboxId: string) {
  updateSandboxRemoteStatusInCache(queryClient, sandboxId, {
    remoteStatus: "paused",
    remoteStatusMessage: "Remote VM stopped. Workspace storage is preserved.",
    remotePublicAddress: null,
  });
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
  const sandboxIds = new Set(sandboxes.map((s) => s.id));
  const preserveActive =
    clientActiveScopeId != null &&
    clientActiveScopeId !== LOCAL_SCOPE_ID &&
    (pendingById.has(clientActiveScopeId) || sandboxIds.has(clientActiveScopeId));
  return {
    ...server,
    enabled: server.enabled || pending.length > 0,
    sandboxes,
    activeScopeId: preserveActive ? clientActiveScopeId : server.activeScopeId,
  };
}
