import * as path from "node:path";
import * as fs from "node:fs";
import type { SandboxSettings } from "./sandbox-settings";

// Pure compose-file rendering, kept free of electron imports so it's unit-testable.

export const DEFAULT_IMAGE_TAG = "mission-control/sandbox-base:latest";
export const CONTAINER_NAME = "mission-control-sandbox";
export const AGENT_CONTAINER_PORT = 9333;

// Defense-in-depth: settings are sanitized on read (sandbox-settings.ts), but
// this is the actual YAML/compose sink, so re-validate the inputs that become
// bare (unquoted) YAML keys/identifiers — they're the host-breakout vector.
const BUILD_ARG_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function quoteYaml(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function safeVolume(name: string, fallback: string): string {
  return VOLUME_NAME.test(name) ? name : fallback;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Render the MC-managed docker-compose.yml from settings.
 *
 * CRITICAL (Phase 1 carry-forward): MC_PAIRING_TOKEN MUST be injected into the
 * container environment — mc-agent fails closed without it. Uses the bundled
 * default image unless a BYO Dockerfile path is configured.
 */
export function renderComposeFile(settings: SandboxSettings, pairingToken: string): string {
  const lines: string[] = [];
  lines.push("services:");
  lines.push("  mc-sandbox:");

  if (settings.dockerfilePath) {
    const dfPath = settings.dockerfilePath;
    const dir = isDirectory(dfPath);
    lines.push("    build:");
    lines.push(`      context: ${quoteYaml(dir ? dfPath : path.dirname(dfPath))}`);
    if (!dir) lines.push(`      dockerfile: ${quoteYaml(path.basename(dfPath))}`);
    const argEntries = Object.entries(settings.buildArgs).filter(([k]) => BUILD_ARG_KEY.test(k));
    if (argEntries.length) {
      lines.push("      args:");
      for (const [k, v] of argEntries) {
        lines.push(`        ${k}: ${quoteYaml(v)}`);
      }
    }
  } else {
    lines.push(`    image: ${quoteYaml(settings.imageTag || DEFAULT_IMAGE_TAG)}`);
  }

  lines.push(`    container_name: ${CONTAINER_NAME}`);
  lines.push("    networks: [mc-bridge]");
  lines.push("    ports:");
  // Bind to the loopback host IP, NOT 0.0.0.0 — a bare "9333:9333" mapping would
  // publish the (token-gated) agent WS and every dev-server port to the whole LAN.
  // The host WS client connects on 127.0.0.1, and Launch URLs resolve to localhost,
  // so loopback is sufficient and keeps the surface off the network.
  lines.push(`      - ${quoteYaml(`127.0.0.1:${settings.agentPort}:${AGENT_CONTAINER_PORT}`)}`);
  for (const p of settings.publishedPorts) {
    if (p === settings.agentPort) continue;
    lines.push(`      - ${quoteYaml(`127.0.0.1:${p}:${p}`)}`);
  }
  lines.push("    extra_hosts:");
  lines.push('      - "host.docker.internal:host-gateway"');
  const wsVol = safeVolume(settings.workspaceVolume, "mc-workspace");
  const cfgVol = safeVolume(settings.agentConfigVolume, "mc-agent-config");
  lines.push("    volumes:");
  lines.push(`      - ${wsVol}:/workspace`);
  lines.push(`      - ${cfgVol}:/home/workspace/.config`);
  lines.push("      - mc-agent-ssh:/home/workspace/.ssh"); // persisted git/SSH keys
  // Persisted agent-CLI auth/state — these live in $HOME (NOT under .config), so
  // without dedicated volumes a container recreate (every stop→start / update)
  // wipes logins. Each dir holds only state (no binaries), so it's safe across
  // image rebuilds. Mount points are root-owned by Docker → chowned at boot by
  // the entrypoint (mirrors the .ssh / .config handling).
  lines.push("      - mc-agent-claude:/home/workspace/.claude"); // Claude Code auth + state
  lines.push("      - mc-agent-codex:/home/workspace/.codex"); // Codex auth
  lines.push("      - mc-agent-cursor:/home/workspace/.cursor"); // Cursor CLI auth + config
  // OpenCode stores its credentials at ~/.local/share/opencode/auth.json (XDG
  // data dir). Mount just that subdir — NOT all of ~/.local — so the cursor-agent
  // binary under ~/.local/share/cursor-agent isn't shadowed/frozen. OpenCode's
  // config (~/.config/opencode) persists via the .config volume above.
  lines.push("      - mc-agent-opencode:/home/workspace/.local/share/opencode"); // OpenCode auth + storage
  lines.push("    environment:");
  lines.push(`      MC_AGENT_PORT: "${AGENT_CONTAINER_PORT}"`);
  lines.push("      MC_WORKSPACE_ROOT: /workspace");
  lines.push("      MC_HOOK_API_HOST: host.docker.internal");
  lines.push(`      MC_PAIRING_TOKEN: ${quoteYaml(pairingToken)}`);
  // Point Claude Code's config dir at the persisted .claude volume. Claude needs
  // BOTH ~/.claude/.credentials.json (token) AND its session-state file to skip
  // login; by default that state file is ~/.claude.json at $HOME root, which is
  // NOT persisted, so login is lost on every container recreate. CLAUDE_CONFIG_DIR
  // consolidates the state file + credentials into this one volume. (Inherited by
  // spawned agent PTYs — pty-host strips only MC_*/TERM_PROGRAM* vars.)
  lines.push("      CLAUDE_CONFIG_DIR: /home/workspace/.claude");
  lines.push("    restart: unless-stopped");
  lines.push("");
  lines.push("volumes:");
  lines.push(`  ${wsVol}:`);
  lines.push(`  ${cfgVol}:`);
  lines.push("  mc-agent-ssh:");
  lines.push("  mc-agent-claude:");
  lines.push("  mc-agent-codex:");
  lines.push("  mc-agent-cursor:");
  lines.push("  mc-agent-opencode:");
  lines.push("");
  lines.push("networks:");
  lines.push("  mc-bridge:");
  lines.push("    driver: bridge");
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: per-sandbox compose. Each sandbox gets its own container, volumes,
// and bridge network so an agent in one sandbox can't see another's files or
// reach it on the network. Derivation is pure + id-namespaced.
// ─────────────────────────────────────────────────────────────────────────────

// Generated sandbox ids are `sb-<base36>-<hex>`; re-validate here since the id
// becomes a bare Docker identifier (container/volume/network name).
const SANDBOX_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export type SandboxResources = {
  /** docker compose project name — namespaces all of this sandbox's resources. */
  project: string;
  container: string;
  network: string;
  volumes: {
    workspace: string;
    config: string;
    ssh: string;
    claude: string;
    codex: string;
    cursor: string;
    opencode: string;
  };
};

/** Derive the per-sandbox Docker resource names from a sandbox id. */
export function sandboxResources(id: string): SandboxResources {
  const safe = SANDBOX_ID.test(id) ? id : "invalid";
  return {
    project: `mc-sb-${safe}`,
    container: `mc-sandbox-${safe}`,
    network: `mc-net-${safe}`,
    volumes: {
      workspace: `mc-sb-${safe}-workspace`,
      config: `mc-sb-${safe}-config`,
      ssh: `mc-sb-${safe}-ssh`,
      claude: `mc-sb-${safe}-claude`,
      codex: `mc-sb-${safe}-codex`,
      cursor: `mc-sb-${safe}-cursor`,
      opencode: `mc-sb-${safe}-opencode`,
    },
  };
}

export type SandboxComposeSpec = {
  id: string;
  imageTag: string | null;
  dockerfilePath: string | null;
  buildArgs: Record<string, string>;
  /** Per-sandbox env / secrets injected into the container (validated keys). */
  env: Record<string, string>;
  /** Host port mapped to the in-container agent WS (container 9333). */
  hostAgentPort: number;
  /** Declared container port → assigned host port (excludes the agent port). */
  portMap: Record<number, number>;
  pairingToken: string;
};

/**
 * Render a per-sandbox docker-compose.yml. Mirrors renderComposeFile but every
 * resource is namespaced by sandbox id and the published ports come from the
 * resolved host-port map (auto-assigned, so concurrent sandboxes never clash).
 */
export function renderSandboxCompose(spec: SandboxComposeSpec): string {
  const res = sandboxResources(spec.id);
  const lines: string[] = [];
  lines.push("services:");
  lines.push("  mc-sandbox:");

  if (spec.dockerfilePath) {
    const dfPath = spec.dockerfilePath;
    const dir = isDirectory(dfPath);
    lines.push("    build:");
    lines.push(`      context: ${quoteYaml(dir ? dfPath : path.dirname(dfPath))}`);
    if (!dir) lines.push(`      dockerfile: ${quoteYaml(path.basename(dfPath))}`);
    const argEntries = Object.entries(spec.buildArgs).filter(([k]) => BUILD_ARG_KEY.test(k));
    if (argEntries.length) {
      lines.push("      args:");
      for (const [k, v] of argEntries) lines.push(`        ${k}: ${quoteYaml(v)}`);
    }
  } else {
    lines.push(`    image: ${quoteYaml(spec.imageTag || DEFAULT_IMAGE_TAG)}`);
  }

  lines.push(`    container_name: ${res.container}`);
  lines.push(`    networks: [${res.network}]`);
  lines.push("    ports:");
  // Loopback-only (see renderComposeFile note). Agent port first, then the
  // declared dev-server ports via their auto-assigned host ports.
  lines.push(`      - ${quoteYaml(`127.0.0.1:${spec.hostAgentPort}:${AGENT_CONTAINER_PORT}`)}`);
  for (const [containerPort, hostPort] of Object.entries(spec.portMap)) {
    if (Number(containerPort) === AGENT_CONTAINER_PORT) continue; // never shadow the agent port
    lines.push(`      - ${quoteYaml(`127.0.0.1:${hostPort}:${containerPort}`)}`);
  }
  lines.push("    extra_hosts:");
  lines.push('      - "host.docker.internal:host-gateway"');
  lines.push("    volumes:");
  lines.push(`      - ${res.volumes.workspace}:/workspace`);
  lines.push(`      - ${res.volumes.config}:/home/workspace/.config`);
  lines.push(`      - ${res.volumes.ssh}:/home/workspace/.ssh`);
  lines.push(`      - ${res.volumes.claude}:/home/workspace/.claude`);
  lines.push(`      - ${res.volumes.codex}:/home/workspace/.codex`);
  lines.push(`      - ${res.volumes.cursor}:/home/workspace/.cursor`);
  lines.push(`      - ${res.volumes.opencode}:/home/workspace/.local/share/opencode`);
  lines.push("    environment:");
  lines.push(`      MC_AGENT_PORT: "${AGENT_CONTAINER_PORT}"`);
  lines.push("      MC_WORKSPACE_ROOT: /workspace");
  lines.push("      MC_HOOK_API_HOST: host.docker.internal");
  lines.push(`      MC_PAIRING_TOKEN: ${quoteYaml(spec.pairingToken)}`);
  lines.push("      CLAUDE_CONFIG_DIR: /home/workspace/.claude");
  for (const [k, v] of Object.entries(spec.env)) {
    if (BUILD_ARG_KEY.test(k)) lines.push(`      ${k}: ${quoteYaml(v)}`);
  }
  lines.push("    restart: unless-stopped");
  lines.push("");
  lines.push("volumes:");
  for (const vol of Object.values(res.volumes)) lines.push(`  ${vol}:`);
  lines.push("");
  lines.push("networks:");
  lines.push(`  ${res.network}:`);
  lines.push("    driver: bridge");
  lines.push("");
  return lines.join("\n");
}
