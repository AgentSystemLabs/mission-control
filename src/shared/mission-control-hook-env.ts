import { isValidTcpPort } from "./tcp-port";

export type PtyHookEnv = {
  apiUrl: string;
  token: string;
};

/** Hostname a sandbox container uses to reach the Mission Control API on the host. */
export const SANDBOX_HOOK_API_HOST = "host.docker.internal";

/** Hostname the Electron host uses to reach its own loopback Mission Control API. */
export const LOCAL_HOOK_API_HOST = "127.0.0.1";

/** Hostname sandbox agent hooks POST to — the agent's own loopback HTTP server. */
export const AGENT_LOCAL_HOOK_API_HOST = LOCAL_HOOK_API_HOST;

// The PTY/agent hook commands POST to whatever host is baked into MC_API_URL.
// On the Electron host that is loopback; inside a sandbox the agent's local HTTP
// API receives hooks and relays them to Mission Control over WebSocket.
// host.docker.internal remains for legacy direct-to-host wiring.
const ALLOWED_HOOK_HOSTS = new Set<string>([
  LOCAL_HOOK_API_HOST,
  SANDBOX_HOOK_API_HOST,
  AGENT_LOCAL_HOOK_API_HOST,
]);

/**
 * Build the Mission Control API base URL an agent's hooks should POST to,
 * parameterized by host so the same construction serves both the Electron host
 * (`127.0.0.1`) and a Docker sandbox container (`host.docker.internal`).
 */
export function buildMissionControlApiUrl(
  host: string,
  port: number | null | undefined,
): string | null {
  if (!ALLOWED_HOOK_HOSTS.has(host)) return null;
  if (!isValidTcpPort(port)) return null;
  return `http://${host}:${port}`;
}

/** Host-side loopback API URL (Electron runtime). */
export function buildLocalMissionControlApiUrl(port: number | null | undefined): string | null {
  return buildMissionControlApiUrl(LOCAL_HOOK_API_HOST, port);
}

/** Sandbox-side API URL reaching the host via host.docker.internal. */
export function buildSandboxMissionControlApiUrl(port: number | null | undefined): string | null {
  return buildMissionControlApiUrl(SANDBOX_HOOK_API_HOST, port);
}

/** Loopback URL for the sandbox agent's own hook HTTP endpoint. */
export function buildAgentLocalHookApiUrl(port: number | null | undefined): string | null {
  return buildMissionControlApiUrl(AGENT_LOCAL_HOOK_API_HOST, port);
}

export function buildSandboxHookRelayUrl(
  mcPort: number | null | undefined,
  slug: string,
  taskId: string,
  hookEvent?: string,
): string | null {
  const base = buildLocalMissionControlApiUrl(mcPort);
  if (!base) return null;
  const url = new URL(`/api/hooks/${slug}`, base);
  url.searchParams.set("taskId", taskId);
  if (hookEvent) url.searchParams.set("hookEvent", hookEvent);
  return url.toString();
}

export function hookEndpointSlug(agent: string | undefined): string {
  if (agent === "codex") return "codex";
  if (agent === "cursor-cli") return "cursor";
  if (agent === "opencode") return "opencode";
  return "claude";
}

export function buildSyntheticHookUrl(
  mcEnv: PtyHookEnv,
  agent: string | undefined,
  taskId: string,
): string | null {
  let base: URL;
  try {
    base = new URL(mcEnv.apiUrl);
  } catch {
    return null;
  }

  if (base.protocol !== "http:" || !ALLOWED_HOOK_HOSTS.has(base.hostname) || !base.port) {
    return null;
  }

  const url = new URL(`/api/hooks/${hookEndpointSlug(agent)}`, base);
  url.searchParams.set("taskId", taskId);
  return url.toString();
}
