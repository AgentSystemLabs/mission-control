import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

// One-time, idempotent data migration to the multi-sandbox model. Preserves
// runtime parity: a user who was running the global Docker sandbox keeps their
// projects executing in a container (now modeled as a "Default" sandbox);
// everyone else stays on Local (host). Reads the legacy electron app_settings
// written by electron/sandbox-settings.ts (same missioncontrol.db).
// See docs/multi-sandbox-plan.md §11.

const MIGRATED_FLAG = "multiSandbox.migrated";
export const SANDBOXES_ENABLED_KEY = "multiSandbox.enabled";
export const ACTIVE_SCOPE_KEY = "multiSandbox.activeScope";

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
}

function newSandboxId(): string {
  return `sb-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function migrateMultiSandbox(db: Database.Database): void {
  if (getSetting(db, MIGRATED_FLAG) === "true") return;

  const wasEnabled = getSetting(db, "sandbox.enabled") === "true";
  const wasDocker = getSetting(db, "sandbox.runtimeMode") === "docker";

  const tx = db.transaction(() => {
    if (wasEnabled && wasDocker) {
      const id = newSandboxId();
      const now = Date.now();
      const agentPort = getSetting(db, "sandbox.agentPort");
      // Carry the legacy single-sandbox config onto the Default row so Phase 2's
      // per-sandbox manager can adopt the already-running container without
      // re-pairing or losing the user's image / git-auth choices.
      db.prepare(
        `INSERT INTO sandboxes
           (id, name, kind, color, image_tag, dockerfile_path, build_args,
            git_auth_mode, declared_ports, env, host_agent_port, port_map,
            pairing_token, remote_config, created_at, updated_at)
         VALUES (?, 'Default', 'remote-vm', NULL, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?)`,
      ).run(
        id,
        getSetting(db, "sandbox.imageTag"),
        getSetting(db, "sandbox.dockerfilePath"),
        getSetting(db, "sandbox.buildArgs"),
        getSetting(db, "sandbox.gitAuthMode") ?? "none",
        getSetting(db, "sandbox.publishedPorts"),
        agentPort ? Number.parseInt(agentPort, 10) || null : null,
        getSetting(db, "sandbox.pairingToken"),
        now,
        now,
      );
      // Every existing project ran in the container under the global toggle, so
      // they all belong to Default. (Local had no per-project concept before.)
      db.prepare("UPDATE projects SET sandbox_id = ? WHERE sandbox_id IS NULL").run(id);
      setSetting(db, SANDBOXES_ENABLED_KEY, "true");
      setSetting(db, ACTIVE_SCOPE_KEY, id);
    } else {
      setSetting(db, SANDBOXES_ENABLED_KEY, wasEnabled ? "true" : "false");
      setSetting(db, ACTIVE_SCOPE_KEY, LOCAL_SCOPE_ID);
    }
    setSetting(db, MIGRATED_FLAG, "true");
  });
  tx();
}
