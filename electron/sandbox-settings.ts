import { randomBytes } from "node:crypto";
import { getStringAppSetting, setAppSetting } from "./app-settings-store";
import { isValidTcpPort } from "../src/shared/tcp-port";

// Typed accessors for the legacy global sandbox settings (Electron-only). These
// live in the main-process app_settings store (not the server /api/settings)
// because the sandbox runtime is Electron-only and the main process owns its
// lifecycle. Vestigial under multi-sandbox; kept so the existing Settings page
// config fields don't crash.
//
// `runtimeMode` is the renderer's host-vs-sandbox routing signal ("docker" means
// "route fs/git/pty through the active sandbox's remote RPC", NOT a Docker
// runtime). See src/lib/sandbox-runtime.ts.
export type SandboxRuntimeMode = "host" | "docker";

/** How git/SSH auth gets into the sandbox VM (US: in-container SSH key setup). */
export type SandboxGitAuthMode = "none" | "copy-host" | "generate";

export type SandboxSettings = {
  enabled: boolean;
  runtimeMode: SandboxRuntimeMode;
  dockerfilePath: string | null;
  buildArgs: Record<string, string>;
  imageTag: string | null;
  publishedPorts: number[];
  workspaceVolume: string;
  projectPaths: Record<string, string>;
  agentPort: number;
  /** null until first generated; never logged or sent to the renderer. */
  pairingToken: string | null;
  gitAuthMode: SandboxGitAuthMode;
};

export const DEFAULT_AGENT_PORT = 9333;
export const DEFAULT_WORKSPACE_VOLUME = "mc-workspace";

const KEYS = {
  enabled: "sandbox.enabled",
  runtimeMode: "sandbox.runtimeMode",
  dockerfilePath: "sandbox.dockerfilePath",
  buildArgs: "sandbox.buildArgs",
  imageTag: "sandbox.imageTag",
  publishedPorts: "sandbox.publishedPorts",
  workspaceVolume: "sandbox.workspaceVolume",
  projectPaths: "sandbox.projectPaths",
  agentPort: "sandbox.agentPort",
  pairingToken: "sandbox.pairingToken",
  gitAuthMode: "sandbox.gitAuthMode",
} as const;

/** Minimal key/value store interface so this module is unit-testable without sqlite. */
export type SettingsKV = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
};

/** Bind the main-process app_settings store to a SettingsKV for a userDataDir. */
export function appSettingsKV(userDataDir: string): SettingsKV {
  return {
    get: (key) => getStringAppSetting(userDataDir, key),
    set: (key, value) => setAppSetting(userDataDir, key, value),
  };
}

// Docker ARG name grammar — guards against compose-YAML key injection (a key
// with a newline could inject sibling service keys like `privileged: true`).
const BUILD_ARG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Docker named-volume grammar — rejects `:`, `/`, `#`, whitespace, newlines so a
// volume name can't be turned into a host bind mount.
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function isValidPort(n: number): boolean {
  return isValidTcpPort(n);
}

export function isValidVolumeName(name: string): boolean {
  return typeof name === "string" && VOLUME_NAME.test(name);
}

/** Drop build-arg entries whose key isn't a valid Docker ARG name. */
export function sanitizeBuildArgs(args: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (BUILD_ARG_KEY.test(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Parse a published-ports spec — a JSON array, a CSV (`3000,5173`), or ranges
 * (`3000-3010`) — into a sorted, de-duplicated list of valid ports. Invalid
 * tokens are dropped rather than throwing.
 */
export function parsePublishedPorts(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) return [];
      return dedupeSortPorts(arr.map((v) => Number(v)).filter(isValidPort));
    } catch {
      return [];
    }
  }

  const out: number[] = [];
  for (const token of trimmed.split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (isValidPort(a) && isValidPort(b) && a <= b) {
        for (let p = a; p <= b; p += 1) out.push(p);
      }
      continue;
    }
    const n = Number(token);
    if (isValidPort(n)) out.push(n);
  }
  return dedupeSortPorts(out);
}

function dedupeSortPorts(ports: number[]): number[] {
  return [...new Set(ports)].sort((a, b) => a - b);
}

function parseJsonRecord(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  return {};
}

function parseIntOr(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return isValidPort(n) ? n : fallback;
}

function safeVolume(raw: string | null, fallback: string): string {
  return raw && isValidVolumeName(raw) ? raw : fallback;
}

const GIT_AUTH_MODES: ReadonlySet<string> = new Set(["none", "copy-host", "generate"]);
function parseGitAuthMode(raw: string | null): SandboxGitAuthMode {
  return raw && GIT_AUTH_MODES.has(raw) ? (raw as SandboxGitAuthMode) : "none";
}

export function readSandboxSettings(kv: SettingsKV): SandboxSettings {
  const runtimeRaw = kv.get(KEYS.runtimeMode);
  return {
    enabled: kv.get(KEYS.enabled) === "true",
    runtimeMode: runtimeRaw === "docker" ? "docker" : "host",
    dockerfilePath: kv.get(KEYS.dockerfilePath) || null,
    // Sanitize on read too, so any value persisted before validation existed
    // can never reach the compose renderer.
    buildArgs: sanitizeBuildArgs(parseJsonRecord(kv.get(KEYS.buildArgs))),
    imageTag: kv.get(KEYS.imageTag) || null,
    publishedPorts: parsePublishedPorts(kv.get(KEYS.publishedPorts)),
    workspaceVolume: safeVolume(kv.get(KEYS.workspaceVolume), DEFAULT_WORKSPACE_VOLUME),
    projectPaths: parseJsonRecord(kv.get(KEYS.projectPaths)),
    agentPort: parseIntOr(kv.get(KEYS.agentPort), DEFAULT_AGENT_PORT),
    pairingToken: kv.get(KEYS.pairingToken) || null,
    gitAuthMode: parseGitAuthMode(kv.get(KEYS.gitAuthMode)),
  };
}

export type SandboxSettingsPatch = Partial<{
  enabled: boolean;
  runtimeMode: SandboxRuntimeMode;
  dockerfilePath: string | null;
  buildArgs: Record<string, string>;
  imageTag: string | null;
  /** Accepts the raw spec string; stored normalized as a JSON array. */
  publishedPorts: string | number[];
  workspaceVolume: string;
  projectPaths: Record<string, string>;
  agentPort: number;
  gitAuthMode: SandboxGitAuthMode;
}>;

/** Write a partial patch; only provided keys are touched. Returns the new state. */
export function writeSandboxSettings(kv: SettingsKV, patch: SandboxSettingsPatch): SandboxSettings {
  if (patch.enabled !== undefined) kv.set(KEYS.enabled, patch.enabled ? "true" : "false");
  if (patch.runtimeMode !== undefined) kv.set(KEYS.runtimeMode, patch.runtimeMode);
  if (patch.dockerfilePath !== undefined) kv.set(KEYS.dockerfilePath, patch.dockerfilePath ?? "");
  if (patch.buildArgs !== undefined) {
    kv.set(KEYS.buildArgs, JSON.stringify(sanitizeBuildArgs(patch.buildArgs)));
  }
  if (patch.imageTag !== undefined) kv.set(KEYS.imageTag, patch.imageTag ?? "");
  if (patch.publishedPorts !== undefined) {
    const ports =
      typeof patch.publishedPorts === "string"
        ? parsePublishedPorts(patch.publishedPorts)
        : dedupeSortPorts(patch.publishedPorts.filter(isValidPort));
    kv.set(KEYS.publishedPorts, JSON.stringify(ports));
  }
  if (patch.workspaceVolume !== undefined && isValidVolumeName(patch.workspaceVolume)) {
    kv.set(KEYS.workspaceVolume, patch.workspaceVolume);
  }
  if (patch.projectPaths !== undefined) kv.set(KEYS.projectPaths, JSON.stringify(patch.projectPaths));
  if (patch.agentPort !== undefined && isValidPort(patch.agentPort)) {
    kv.set(KEYS.agentPort, String(patch.agentPort));
  }
  if (patch.gitAuthMode !== undefined && GIT_AUTH_MODES.has(patch.gitAuthMode)) {
    kv.set(KEYS.gitAuthMode, patch.gitAuthMode);
  }
  return readSandboxSettings(kv);
}

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

/** Return the existing pairing token, generating + persisting one if absent. */
export function ensurePairingToken(kv: SettingsKV): string {
  const existing = kv.get(KEYS.pairingToken);
  if (existing) return existing;
  const token = generateToken();
  kv.set(KEYS.pairingToken, token);
  return token;
}

/** Rotate the pairing token (on disconnect / explicit user action). */
export function rotatePairingToken(kv: SettingsKV): string {
  const token = generateToken();
  kv.set(KEYS.pairingToken, token);
  return token;
}
