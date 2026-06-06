import type { Sandbox } from "~/db/schema";
import {
  LOCAL_SCOPE_ID,
  normalizeRemoteAgentUrl,
  type SandboxGitAuthMode,
  type SandboxKind,
  type SandboxPublicView,
  type SandboxRemoteConfig,
} from "~/shared/sandbox";
import { ACTIVE_SCOPE_KEY, SANDBOXES_ENABLED_KEY } from "~/db/migrate-multi-sandbox";
import {
  deleteSandboxRow,
  findAllSandboxes,
  findSandboxById,
  insertSandbox,
  updateSandboxRow,
} from "../repositories/sandboxes.repo";
import { findProjectIdsBySandboxId } from "../repositories/projects.repo";
import { events } from "../events";
import { deleteAllProjectImagesFor } from "./project-images";
import { getBooleanSetting, getSetting, setBooleanSetting, setSetting } from "./settings";
import { FREE_SANDBOX_CAP, isProTier } from "~/shared/license";
import { readLicenseState } from "./license";
import { newId } from "./_ids";

export class SandboxCapExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(
      `Mission Control Lite is limited to ${limit} sandbox${limit === 1 ? "" : "es"} (plus Local). Upgrade to Pro for unlimited sandboxes.`,
    );
    this.name = "SandboxCapExceededError";
  }
}

// CRUD + scope-selection for sandboxes (isolated execution environments). The
// container lifecycle is owned by the Electron main; Phase 1 manages only the
// model + the active-scope/enabled UI state. See docs/multi-sandbox-plan.md.

export type SandboxState = {
  sandboxes: SandboxPublicView[];
  enabled: boolean;
  activeScopeId: string;
};

const MAX_TCP_PORT = 65_535;
const CONFIG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

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
  const parsed = parseJson<SandboxRemoteConfig | null>(raw, null);
  if (!parsed || typeof parsed.agentUrl !== "string") return null;
  const allowPlaintextPublic = parsed.allowPlaintextPublic === true;
  const agentUrl = normalizeRemoteAgentUrl(parsed.agentUrl, { allowPlaintextPublic });
  return agentUrl ? { ...parsed, agentUrl, ...(allowPlaintextPublic ? { allowPlaintextPublic } : {}) } : null;
}

function normalizeRemoteAgentUrlForPatch(
  value: string,
  existing: SandboxRemoteConfig | null,
): { agentUrl: string; allowPlaintextPublic: boolean } | null {
  const allowExistingPlaintext = existing?.allowPlaintextPublic === true;
  const agentUrl =
    normalizeRemoteAgentUrl(value, { allowPlaintextPublic: allowExistingPlaintext }) ??
    normalizeRemoteAgentUrl(value, { allowPlaintextPublic: true });
  if (!agentUrl) return null;
  return {
    agentUrl,
    allowPlaintextPublic: allowExistingPlaintext || agentUrl.startsWith("ws://"),
  };
}

function toPublicSandbox(row: Sandbox): SandboxPublicView {
  const buildArgs = parseJson(row.buildArgs, {});
  const remote = parseRemoteConfig(row.remoteConfig);
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
    declaredPorts: parseJson(row.declaredPorts, []),
    remoteAgentUrl: remote?.agentUrl ?? null,
    remoteProvider: typeof remote?.provider === "string" ? remote.provider : null,
    remoteProviderName: typeof remote?.providerName === "string" ? remote.providerName : null,
    remoteStatus: typeof remote?.status === "string" ? remote.status : null,
    remoteStatusMessage: typeof remote?.statusMessage === "string" ? remote.statusMessage : null,
    remotePublicAddress: typeof remote?.publicIp === "string" ? remote.publicIp : null,
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

export type CreateSandboxInput = {
  name: string;
  kind?: SandboxKind;
  color?: string | null;
  remoteAgentUrl?: string | null;
  apiKey?: string | null;
};

export function createSandbox(input: CreateSandboxInput): SandboxPublicView {
  if (!isProTier(readLicenseState())) {
    const existing = findAllSandboxes();
    if (existing.length >= FREE_SANDBOX_CAP) {
      throw new SandboxCapExceededError(FREE_SANDBOX_CAP, existing.length);
    }
  }

  const now = Date.now();
  const kind = input.kind ?? "local-docker";
  const remoteAgentUrl =
    kind === "remote-vm" && input.remoteAgentUrl
      ? normalizeRemoteAgentUrl(input.remoteAgentUrl)
      : null;
  const row: Sandbox = {
    id: newId("sb"),
    name: input.name.trim() || "Sandbox",
    kind,
    color: input.color ?? null,
    imageTag: null,
    dockerfilePath: null,
    buildArgs: null,
    gitAuthMode: "none",
    copyAgentCreds: false,
    declaredPorts: null,
    env: null,
    hostAgentPort: null,
    portMap: null,
    pairingToken: kind === "remote-vm" ? (input.apiKey?.trim() || null) : null,
    remoteConfig: remoteAgentUrl ? JSON.stringify({ agentUrl: remoteAgentUrl } satisfies SandboxRemoteConfig) : null,
    createdAt: now,
    updatedAt: now,
  };
  insertSandbox(row);
  // Creating a sandbox implies the feature is on, so the dropdown surfaces.
  setBooleanSetting(SANDBOXES_ENABLED_KEY, true);
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
    remoteAgentUrl: string | null;
    apiKey: string | null;
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
  if (patch.remoteAgentUrl !== undefined) {
    const existing = parseRemoteConfig(current.remoteConfig);
    const normalized = patch.remoteAgentUrl
      ? normalizeRemoteAgentUrlForPatch(patch.remoteAgentUrl, existing)
      : null;
    rowPatch.remoteConfig = normalized
      ? JSON.stringify({
          ...(existing ?? {}),
          agentUrl: normalized.agentUrl,
          ...(normalized.allowPlaintextPublic ? { allowPlaintextPublic: true } : {}),
        } satisfies SandboxRemoteConfig)
      : null;
  }
  if (patch.apiKey !== undefined) {
    rowPatch.pairingToken = patch.apiKey?.trim() || null;
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
