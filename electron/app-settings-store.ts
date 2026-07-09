import * as path from "node:path";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";

let _db: Database.Database | null = null;

// missioncontrol.db holds the API bearer + sandbox pairing tokens in cleartext;
// with default perms it is world-readable. Lock it (and WAL/SHM sidecars) to
// owner-only. Best-effort — a no-op on non-POSIX filesystems.
function restrictDbFilePermissions(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
    } catch {
      /* best effort */
    }
  }
}

function openDb(userDataDir: string): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(userDataDir, "missioncontrol.db");
  const db = new Database(dbPath, {
    nativeBinding: resolveElectronBetterSqlite3NativeBinding(),
  });
  db.pragma("journal_mode = WAL");
  restrictDbFilePermissions(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  );
  _db = db;
  return db;
}

export function getBooleanAppSetting(
  userDataDir: string,
  key: string,
  defaultValue = false,
): boolean {
  const db = openDb(userDataDir);
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return defaultValue;
  return row.value === "true";
}

export function getStringAppSetting(userDataDir: string, key: string): string | null {
  const db = openDb(userDataDir);
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppSetting(userDataDir: string, key: string, value: string): void {
  const db = openDb(userDataDir);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
}

export function deleteAppSetting(userDataDir: string, key: string): void {
  const db = openDb(userDataDir);
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}

export function disposeAppSettingsStore(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* best effort */
    }
    _db = null;
  }
}
