import * as path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";
import type { SandboxConfig } from "./sandbox-types";
import { normalizeRemoteAgentUrl, type SandboxRemoteConfig } from "../src/shared/sandbox";

// Electron-main read access to the `sandboxes` table (owned by the server via
// Drizzle, but the container lifecycle lives in the main process). Mirrors how
// project-roots.ts reads `projects` directly. Port assignments are written back
// here so they stay stable across restarts. Same missioncontrol.db file.

let _db: Database.Database | null = null;

function db(userDataDir: string): Database.Database {
  if (_db) return _db;
  const d = new Database(path.join(userDataDir, "missioncontrol.db"), {
    nativeBinding: resolveElectronBetterSqlite3NativeBinding(),
  });
  d.pragma("journal_mode = WAL");
  _db = d;
  return d;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type SandboxRow = {
  id: string;
  kind: string;
  image_tag: string | null;
  dockerfile_path: string | null;
  build_args: string | null;
  env: string | null;
  git_auth_mode: string | null;
  copy_agent_creds: number | null;
  declared_ports: string | null;
  host_agent_port: number | null;
  port_map: string | null;
  pairing_token: string | null;
  remote_config: string | null;
};

function toGitAuthMode(v: string | null): "none" | "copy-host" | "generate" {
  return v === "copy-host" || v === "generate" ? v : "none";
}

function toConfig(row: SandboxRow): SandboxConfig {
  const remote = parseJson<SandboxRemoteConfig | null>(row.remote_config, null);
  const remoteAgentUrl =
    remote && typeof remote.agentUrl === "string"
      ? normalizeRemoteAgentUrl(remote.agentUrl, {
          allowPlaintextPublic: remote.allowPlaintextPublic === true,
        })
      : null;
  return {
    id: row.id,
    kind: row.kind === "remote-vm" ? "remote-vm" : "local-docker",
    imageTag: row.image_tag,
    dockerfilePath: row.dockerfile_path,
    buildArgs: parseJson(row.build_args, {}),
    env: parseJson(row.env, {}),
    gitAuthMode: toGitAuthMode(row.git_auth_mode),
    copyAgentCreds: row.copy_agent_creds === 1,
    declaredPorts: parseJson(row.declared_ports, []),
    hostAgentPort: row.host_agent_port,
    portMap: parseJson(row.port_map, null),
    remoteAgentUrl,
    pairingToken: row.pairing_token,
    remoteAgentCa: remote && typeof remote.agentCa === "string" ? remote.agentCa : null,
    remoteStatus: remote && typeof remote.status === "string" ? remote.status : null,
  };
}

export function readSandboxConfig(userDataDir: string, id: string): SandboxConfig | null {
  try {
    const row = db(userDataDir).prepare("SELECT * FROM sandboxes WHERE id = ?").get(id) as
      | SandboxRow
      | undefined;
    return row ? toConfig(row) : null;
  } catch {
    return null; // table may not exist yet (server hasn't bootstrapped)
  }
}

export function listSandboxConfigs(userDataDir: string): SandboxConfig[] {
  try {
    const rows = db(userDataDir).prepare("SELECT * FROM sandboxes").all() as SandboxRow[];
    return rows.map(toConfig);
  } catch {
    return [];
  }
}

export function persistSandboxPorts(
  userDataDir: string,
  id: string,
  hostAgentPort: number,
  portMap: Record<number, number>,
): void {
  try {
    db(userDataDir)
      .prepare("UPDATE sandboxes SET host_agent_port = ?, port_map = ?, updated_at = ? WHERE id = ?")
      .run(hostAgentPort, JSON.stringify(portMap), Date.now(), id);
  } catch {
    /* best effort — ports get re-assigned next start if this fails */
  }
}

/** Per-sandbox pairing token (generated + persisted on first use). */
export function ensureSandboxPairingToken(userDataDir: string, id: string): string {
  const d = db(userDataDir);
  const row = d.prepare("SELECT pairing_token FROM sandboxes WHERE id = ?").get(id) as
    | { pairing_token: string | null }
    | undefined;
  if (row?.pairing_token) return row.pairing_token;
  const token = randomBytes(24).toString("hex");
  d.prepare("UPDATE sandboxes SET pairing_token = ?, updated_at = ? WHERE id = ?").run(
    token,
    Date.now(),
    id,
  );
  return token;
}

export function rotateSandboxPairingToken(userDataDir: string, id: string): void {
  try {
    db(userDataDir)
      .prepare("UPDATE sandboxes SET pairing_token = NULL, updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
  } catch {
    /* best effort */
  }
}

/** The persisted active scope as a sandbox id, or null for Local. */
export function readActiveSandboxId(userDataDir: string): string | null {
  try {
    const row = db(userDataDir)
      .prepare("SELECT value FROM app_settings WHERE key = 'multiSandbox.activeScope'")
      .get() as { value: string } | undefined;
    const v = row?.value;
    return v && v !== "local" ? v : null;
  } catch {
    return null;
  }
}

export function isSandboxesEnabled(userDataDir: string): boolean {
  try {
    const row = db(userDataDir)
      .prepare("SELECT value FROM app_settings WHERE key = 'multiSandbox.enabled'")
      .get() as { value: string } | undefined;
    return row?.value === "true";
  } catch {
    return false;
  }
}

export function disposeSandboxStore(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* best effort */
    }
    _db = null;
  }
}
