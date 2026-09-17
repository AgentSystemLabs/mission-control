import * as fs from "node:fs";

/**
 * missioncontrol.db holds the API bearer token and every sandbox pairing token
 * in cleartext. Created with default perms it is world-readable (~0644), so any
 * other local user / backup / sync process can lift those secrets straight off
 * disk. Tighten the DB (plus its WAL/SHM sidecars) to owner-only. Best-effort:
 * on filesystems/platforms without POSIX modes (e.g. Windows) chmod is a
 * harmless no-op.
 */
export function restrictDbFilePermissions(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
    } catch {
      /* best effort */
    }
  }
}
