import * as path from "node:path";
import * as fs from "node:fs";
import Database from "better-sqlite3";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";

let _db: Database.Database | null = null;

function openDb(userDataDir: string): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "missioncontrol.db");
  const db = new Database(dbPath, {
    nativeBinding: resolveElectronBetterSqlite3NativeBinding(),
  });
  db.pragma("journal_mode = WAL");
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
