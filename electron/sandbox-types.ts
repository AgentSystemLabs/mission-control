// Shared sandbox runtime types used by the legacy single-sandbox manager and the
// Phase 2 per-sandbox registry. Keeping the state union here avoids a duplicate
// definition / import cycle between the two.

// State machine surfaced to the renderer. `running` = container up but the WS
// isn't paired yet; `connected` = mc-agent `ready` received.
export type SandboxState =
  | { status: "disabled" }
  | { status: "stopped"; dockerAvailable: boolean }
  | { status: "starting"; step: string }
  | { status: "running" }
  | { status: "connected"; version: string; agents: Record<string, string | null> }
  | {
      status: "update-required";
      version: string;
      expectedVersion: string;
      agents: Record<string, string | null>;
    }
  | { status: "error"; message: string };

/** A sandbox state tagged with the sandbox it belongs to (for registry fan-out). */
export type ScopedSandboxState = { sandboxId: string; state: SandboxState };

/** The subset of a `sandboxes` DB row the runtime needs to start a container. */
export type SandboxConfig = {
  id: string;
  kind: "local-docker" | "remote-vm";
  imageTag: string | null;
  dockerfilePath: string | null;
  buildArgs: Record<string, string>;
  env: Record<string, string>;
  gitAuthMode: "none" | "copy-host" | "generate";
  declaredPorts: number[];
  hostAgentPort: number | null;
  portMap: Record<number, number> | null;
  remoteAgentUrl: string | null;
  pairingToken: string | null;
};

export type OpResult = { ok: true } | { ok: false; error: string };

// The mc-agent protocol version this host build speaks. Must match mc-agent's
// AGENT_VERSION; a mismatch surfaces as `update-required`.
export const EXPECTED_SANDBOX_AGENT_VERSION = "0.3.0";

export function isSandboxAgentVersionCurrent(version: string): boolean {
  return version === EXPECTED_SANDBOX_AGENT_VERSION;
}
