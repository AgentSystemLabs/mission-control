import { findSandboxById } from "../repositories/sandboxes.repo";
import { LOCAL_SCOPE_ID, type SandboxRemoteConfig } from "~/shared/sandbox";
import { ValidationError } from "../errors";

function remoteConfigProjectId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SandboxRemoteConfig> | null;
    return typeof parsed?.projectId === "string" && parsed.projectId.trim()
      ? parsed.projectId
      : null;
  } catch {
    return null;
  }
}

export function normalizeProjectScopeId(
  projectId: string,
  scopeId: string | null | undefined,
): string {
  const normalized = scopeId?.trim() || LOCAL_SCOPE_ID;
  if (normalized === LOCAL_SCOPE_ID) return LOCAL_SCOPE_ID;

  const sandbox = findSandboxById(normalized);
  if (!sandbox) throw new ValidationError("Sandbox scope does not exist");

  const ownerProjectId = remoteConfigProjectId(sandbox.remoteConfig);
  if (ownerProjectId && ownerProjectId !== projectId) {
    throw new ValidationError("Sandbox scope does not belong to this project");
  }

  return normalized;
}
