import type { Sandbox } from "~/db/schema";
import { MAX_TCP_PORT } from "~/shared/tcp-port";
import { safeJsonParse } from "~/shared/safe-json";
import {
  LOCAL_SCOPE_ID,
  normalizeRemoteAgentUrl,
  parseSandboxImageProvenance,
  type SandboxGitAuthMode,
  type SandboxPublicView,
  type SandboxRemoteConfig,
} from "~/shared/sandbox";
import { ACTIVE_SCOPE_KEY, SANDBOXES_ENABLED_KEY } from "~/db/migrate-multi-sandbox";
import { randomUUID } from "node:crypto";
import {
  deleteSandboxRow,
  findAllSandboxes,
  findSandboxById,
  insertSandbox,
  updateSandboxRow,
} from "../repositories/sandboxes.repo";
import { findProjectIdsBySandboxId } from "../repositories/projects.repo";
import { deleteTasksByScope } from "../repositories/tasks.repo";
import { deleteUserTerminalsByScope } from "../repositories/user-terminals.repo";
import { deleteHomeTerminalsByScope } from "../repositories/home-terminals.repo";
import { events } from "../events";
import { deleteAllProjectImagesFor } from "./project-images";
import { getBooleanSetting, getSetting, setBooleanSetting, setSetting } from "./settings";

// CRUD + scope-selection for sandboxes (isolated execution environments). The
// container lifecycle is owned by the Electron main; Phase 1 manages only the
// model + the active-scope/enabled UI state. See docs/multi-sandbox-plan.md.

export type SandboxState = {
  sandboxes: SandboxPublicView[];
  enabled: boolean;
  activeScopeId: string;
};

const CONFIG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sanitizeRecord(value: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!value) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (CONFIG_KEY.test(key) && typeof raw === "string") out[key] = raw;
  }
  return Object.keys(out).length ? out : null;
}

function normalizePorts(value: number[] | null | undefined): number[] | null {
  if (!value) return null;
  const ports = [...new Set(value.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 1 && v <= MAX_TCP_PORT))];
  ports.sort((a, b) => a - b);
  return ports.length ? ports : null;
}

function parseRemoteConfig(raw: string | null | undefined): SandboxRemoteConfig | null {
  const parsed = safeJsonParse<SandboxRemoteConfig | null>(raw, null);
  if (!parsed || typeof parsed.agentUrl !== "string") return null;
  const allowPlaintextPublic = parsed.allowPlaintextPublic === true;
  const agentUrl = normalizeRemoteAgentUrl(parsed.agentUrl, { allowPlaintextPublic });
  return agentUrl ? { ...parsed, agentUrl, ...(allowPlaintextPublic ? { allowPlaintextPublic } : {}) } : null;
}

function toPublicSandbox(row: Sandbox): SandboxPublicView {
  const buildArgs = safeJsonParse(row.buildArgs, {});
  const remote = parseRemoteConfig(row.remoteConfig);
  const image = parseSandboxImageProvenance(remote);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    imageTag: row.imageTag,
    dockerfilePath: row.dockerfilePath,
    buildArgKeys: Object.keys(buildArgs).sort(),
    hasBuildArgs: Object.keys(buildArgs).length > 0,
    gitAuthMode: row.gitAuthMode,
    declaredPorts: safeJsonParse(row.declaredPorts, []),
    remoteAgentUrl: remote?.agentUrl ?? null,
    remoteProvider: typeof remote?.provider === "string" ? remote.provider : null,
    remoteProviderName: typeof remote?.providerName === "string" ? remote.providerName : null,
    remoteStatus: typeof remote?.status === "string" ? remote.status : null,
    remoteStatusMessage: typeof remote?.statusMessage === "string" ? remote.statusMessage : null,
    remotePublicAddress: typeof remote?.publicIp === "string" ? remote.publicIp : null,
    projectId: typeof remote?.projectId === "string" ? remote.projectId : null,
    remoteImageId: image.imageId,
    remoteGoldenImage: image.goldenImage,
    remoteImageManifestVersion: image.imageManifestVersion,
    remoteImageAgentVersion: image.imageAgentVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasPairingToken: !!row.pairingToken,
    hasApiKey: row.kind === "remote-vm" && !!row.pairingToken,
    hasPortMap: !!row.portMap,
  };
}

/** The renderer's one-shot read: sandboxes + whether the dropdown shows + the
 *  selected scope (self-heals a dangling scope whose sandbox was deleted). */
export function getSandboxState(): SandboxState {
  const list = findAllSandboxes();
  const enabled = getBooleanSetting(SANDBOXES_ENABLED_KEY, false);
  let activeScopeId = getSetting(ACTIVE_SCOPE_KEY) ?? LOCAL_SCOPE_ID;
  if (activeScopeId !== LOCAL_SCOPE_ID && !list.some((s) => s.id === activeScopeId)) {
    activeScopeId = LOCAL_SCOPE_ID;
    setSetting(ACTIVE_SCOPE_KEY, activeScopeId);
  }
  return { sandboxes: list.map(toPublicSandbox), enabled, activeScopeId };
}

export type ConnectRemoteSandboxInput = {
  name: string;
  agentUrl: string;
  apiKey: string;
  agentCa?: string | null;
};

/**
 * Register an externally-provisioned remote sandbox (the user installed and
 * started the agent themselves) so the existing connect machinery can reach it.
 * Unlike managed rows, no `provider`/`providerId`/`status` are persisted —
 * provider-less rows are what mark a sandbox as manually connected, keeping
 * every managed-cloud affordance (pause/resume/reconcile/teardown) off.
 * Returns null when the agent URL does not survive normalization (plaintext
 * ws:// to a non-loopback host, credentials/query in the URL, unparseable).
 */
export function connectRemoteSandbox(
  input: ConnectRemoteSandboxInput,
): SandboxPublicView | null {
  const agentUrl = normalizeRemoteAgentUrl(input.agentUrl);
  if (!agentUrl) return null;
  const agentCa = input.agentCa?.trim() || null;
  const now = Date.now();

  // Idempotent by agent endpoint: re-connecting to the same URL (retry after a
  // failed connect, rotated key, fresh CA) updates the existing manual row
  // instead of piling up duplicates. Managed rows always carry a provider, so
  // they can never be captured by this match.
  const existing = findAllSandboxes().find((row) => {
    if (row.kind !== "remote-vm") return false;
    const remote = parseRemoteConfig(row.remoteConfig);
    return !!remote && !remote.provider && remote.agentUrl === agentUrl;
  });
  const id = existing?.id ?? randomUUID();
  const remoteConfig: SandboxRemoteConfig = {
    agentUrl,
    ...(agentCa ? { agentCa } : {}),
    createdAt: existing ? parseRemoteConfig(existing.remoteConfig)?.createdAt ?? now : now,
    updatedAt: now,
  };
  if (existing) {
    updateSandboxRow(id, {
      name: input.name.trim(),
      pairingToken: input.apiKey,
      remoteConfig: JSON.stringify(remoteConfig),
      updatedAt: now,
    });
  } else {
    insertSandbox({
      id,
      name: input.name.trim(),
      kind: "remote-vm",
      pairingToken: input.apiKey,
      remoteConfig: JSON.stringify(remoteConfig),
      createdAt: now,
      updatedAt: now,
    });
  }
  // Mirror the deploy CLI: registering a sandbox turns the scope switcher on so
  // the new row is immediately reachable.
  setBooleanSetting(SANDBOXES_ENABLED_KEY, true);
  const row = findSandboxById(id);
  // The row was just written; a miss is a server fault, not a bad request.
  if (!row) throw new Error("sandbox row missing after connect write");
  return toPublicSandbox(row);
}

export type UpdateSandboxPatch = Partial<{
  name: string;
  color: string | null;
  imageTag: string | null;
  dockerfilePath: string | null;
  gitAuthMode: SandboxGitAuthMode;
  buildArgs: Record<string, string> | null;
  declaredPorts: number[] | null;
}>;

export function revealSandboxApiKey(id: string): string | null {
  const row = findSandboxById(id);
  if (!row || row.kind !== "remote-vm" || !row.pairingToken) return null;
  return row.pairingToken;
}

export function updateSandbox(id: string, patch: UpdateSandboxPatch): SandboxPublicView | null {
  const current = findSandboxById(id);
  if (!current) return null;
  const rowPatch: Partial<Sandbox> = { updatedAt: Date.now() };
  if (patch.name !== undefined) rowPatch.name = patch.name;
  if (patch.color !== undefined) rowPatch.color = patch.color;
  if (patch.imageTag !== undefined) rowPatch.imageTag = patch.imageTag;
  if (patch.dockerfilePath !== undefined) rowPatch.dockerfilePath = patch.dockerfilePath;
  if (patch.gitAuthMode !== undefined) rowPatch.gitAuthMode = patch.gitAuthMode;
  if (patch.buildArgs !== undefined) {
    const clean = sanitizeRecord(patch.buildArgs);
    rowPatch.buildArgs = clean ? JSON.stringify(clean) : null;
  }
  if (patch.declaredPorts !== undefined) {
    const ports = normalizePorts(patch.declaredPorts);
    rowPatch.declaredPorts = ports ? JSON.stringify(ports) : null;
  }
  updateSandboxRow(id, rowPatch);
  const next = findSandboxById(id);
  return next ? toPublicSandbox(next) : null;
}

/** Destroys the sandbox row (cascade-deleting its projects). Call
 *  `electron.sandbox.destroy` before this so container/volume teardown still
 *  has the persisted config. */
export function deleteSandbox(id: string): boolean {
  if (!findSandboxById(id)) return false;

  for (const projectId of findProjectIdsBySandboxId(id)) {
    deleteAllProjectImagesFor(projectId);
    events.emit("project:deleted", { id: projectId });
  }
  deleteTasksByScope(id);
  deleteUserTerminalsByScope(id);
  deleteHomeTerminalsByScope(id);

  const removed = deleteSandboxRow(id) > 0;
  if (removed && getSetting(ACTIVE_SCOPE_KEY) === id) {
    setSetting(ACTIVE_SCOPE_KEY, LOCAL_SCOPE_ID);
  }
  return removed;
}

export function setActiveScope(scopeId: string): string {
  const resolved =
    scopeId === LOCAL_SCOPE_ID || findSandboxById(scopeId) ? scopeId : LOCAL_SCOPE_ID;
  setSetting(ACTIVE_SCOPE_KEY, resolved);
  return resolved;
}

export function setSandboxesEnabled(enabled: boolean): void {
  setBooleanSetting(SANDBOXES_ENABLED_KEY, enabled);
}
