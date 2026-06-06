export const DEFAULT_AGENT_PORT = 9333;
export const DEFAULT_WORKSPACE_ROOT = "/workspace";
export const DEFAULT_HOOK_API_HOST = "host.docker.internal";
export const DEFAULT_BIND_HOST = "0.0.0.0";

export type AgentConfig = {
  /** WebSocket + health HTTP port. */
  port: number;
  /** Interface to bind. Use `::` for dual-stack private networking hosts. */
  bindHost: string;
  /** Root the named workspace volume is mounted at; all RPC + spawns are confined here. */
  workspaceRoot: string;
  /**
   * Bearer API key / pairing token; WS connections must present it via
   * `Authorization: Bearer`.
   * Empty string disables pairing — only acceptable in local manual testing.
   */
  pairingToken: string;
  /** Host the in-container agent hooks POST back to (the MC API on the Docker host). */
  hookApiHost: string;
  /** Explicit opt-in to run with pairing disabled (local manual testing only). */
  allowInsecure: boolean;
  /**
   * Path the agent stamps on every PTY/RPC so an on-VM idle watchdog can read its
   * mtime and stop the instance after inactivity. Empty disables heartbeat writes
   * (Docker sandboxes, local testing).
   */
  activityFile: string;
};

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const portFallback = intFromEnv(env, "PORT", DEFAULT_AGENT_PORT);
  return {
    port: intFromEnv(env, "MC_AGENT_PORT", portFallback),
    bindHost: env.MC_AGENT_BIND_HOST || env.HOST || DEFAULT_BIND_HOST,
    workspaceRoot: env.MC_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT,
    pairingToken: env.MC_AGENT_API_KEY || env.MC_PAIRING_TOKEN || "",
    hookApiHost: env.MC_HOOK_API_HOST || DEFAULT_HOOK_API_HOST,
    allowInsecure: env.MC_AGENT_INSECURE === "1",
    activityFile: env.MC_AGENT_ACTIVITY_FILE || "",
  };
}
