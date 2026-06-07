import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "~/lib/api";
import {
  mergeServerSandboxesPreservingPending,
  restoreSandboxesCache,
  type SandboxesQueryData,
} from "~/lib/optimistic-sandbox";
import { queryKeys } from "~/queries";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";

export function projectRuntimeScopeId(
  sandboxState: SandboxesQueryData | undefined,
  projectId: string,
  scopeId: string,
): string {
  const normalized = normalizeScopeId(scopeId);
  if (normalized === LOCAL_SCOPE_ID) return LOCAL_SCOPE_ID;
  if (!sandboxState?.enabled) return LOCAL_SCOPE_ID;

  const sandbox = sandboxState.sandboxes.find((entry) => entry.id === normalized);
  if (
    sandbox?.kind === "remote-vm" &&
    sandbox.remoteProvider === "aws" &&
    sandbox.projectId === projectId
  ) {
    return normalized;
  }

  return LOCAL_SCOPE_ID;
}

export function scopeIdToActivate(
  sandboxState: SandboxesQueryData | undefined,
  projectId: string,
  scopeId: string,
): string {
  const targetRuntimeScopeId = projectRuntimeScopeId(sandboxState, projectId, scopeId);
  return targetRuntimeScopeId === LOCAL_SCOPE_ID
    ? LOCAL_SCOPE_ID
    : normalizeScopeId(scopeId);
}

export async function activateSandboxScope(
  queryClient: QueryClient,
  scopeId: string,
): Promise<boolean> {
  const normalized = normalizeScopeId(scopeId);
  const previous = queryClient.getQueryData<SandboxesQueryData>(queryKeys.sandboxes);
  const currentActive = normalizeScopeId(previous?.activeScopeId ?? LOCAL_SCOPE_ID);
  if (currentActive === normalized) return true;

  queryClient.setQueryData<SandboxesQueryData>(queryKeys.sandboxes, (current) => {
    if (!current) {
      return { sandboxes: [], enabled: true, activeScopeId: normalized };
    }
    return { ...current, activeScopeId: normalized };
  });

  try {
    await api.setActiveScope(normalized);
    const server = await api.listSandboxes();
    queryClient.setQueryData(
      queryKeys.sandboxes,
      mergeServerSandboxesPreservingPending(server, [], normalized),
    );
    return true;
  } catch (error) {
    restoreSandboxesCache(queryClient, previous);
    toast.error(error instanceof Error ? error.message : "Failed to switch sandbox.");
    return false;
  }
}
