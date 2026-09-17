import * as fs from "node:fs";
import type Database from "better-sqlite3";
import { closeQuietly, ensureAppSettingsTable, openMissionControlDb } from "./mission-control-db";

let _db: Database.Database | null = null;

function openDb(userDataDir: string): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  const db = openMissionControlDb(userDataDir);
  ensureAppSettingsTable(db);
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
  closeQuietly(_db);
  _db = null;
}
