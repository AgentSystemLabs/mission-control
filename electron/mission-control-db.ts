import * as path from "node:path";
import Database from "better-sqlite3";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";
import { restrictDbFilePermissions } from "../src/shared/sqlite-file-permissions";

// The Electron main process opens its own connections to the server-owned
// missioncontrol.db (the server's Drizzle client owns the schema). Every such
// connection needs the same WAL / busy-wait / permission setup, so it lives here.

export const MISSION_CONTROL_DB_FILENAME = "missioncontrol.db";

export function missionControlDbPath(userDataDir: string): string {
  return path.join(userDataDir, MISSION_CONTROL_DB_FILENAME);
}

/** Open a main-process connection to missioncontrol.db with the standard pragmas. */
export function openMissionControlDb(userDataDir: string): Database.Database {
  const dbPath = missionControlDbPath(userDataDir);
  const db = new Database(dbPath, {
    nativeBinding: resolveElectronBetterSqlite3NativeBinding(),
  });
  db.pragma("journal_mode = WAL");
  // Wait (up to 5s) for a concurrent checkpoint/writer instead of throwing
  // SQLITE_BUSY the instant the server process holds the write lock.
  db.pragma("busy_timeout = 5000");
  restrictDbFilePermissions(dbPath);
  return db;
}

/**
 * The server's ensureSchema() owns the canonical table layout; this CREATE IF
 * NOT EXISTS matches the server definition so a first IPC call before the
 * server has bootstrapped still finds the table to read from.
 */
export function ensureAppSettingsTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  );
}

/** Close a cached connection, swallowing errors — used by the store dispose hooks. */
export function closeQuietly(db: Database.Database | null): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* best effort */
  }
}
