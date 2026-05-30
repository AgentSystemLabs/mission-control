export type PtyHookEnv = {
  apiUrl: string;
  token: string;
};

const MAX_TCP_PORT = 65535;

/** Hostname a sandbox container uses to reach the Mission Control API on the host. */
export const SANDBOX_HOOK_API_HOST = "host.docker.internal";

/** Hostname the Electron host uses to reach its own loopback Mission Control API. */
export const LOCAL_HOOK_API_HOST = "127.0.0.1";

// The PTY/agent hook commands POST to whatever host is baked into MC_API_URL.
// On the Electron host that is loopback; inside a Docker sandbox the same API is
// reachable via host.docker.internal. Only these two are ever legitimate, so we
// allow-list them to keep buildSyntheticHookUrl from being pointed at an
// arbitrary external host by a malformed env.
const ALLOWED_HOOK_HOSTS = new Set<string>([LOCAL_HOOK_API_HOST, SANDBOX_HOOK_API_HOST]);

function isValidPort(port: number | null | undefined): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= MAX_TCP_PORT;
}

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
  if (!isValidPort(port)) return null;
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
