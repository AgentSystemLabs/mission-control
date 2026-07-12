import * as path from "node:path";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { resolveElectronBetterSqlite3NativeBinding } from "./better-sqlite3-native-binding";

// The api bearer token never crosses HTTP. Renderer and main hold it; external
// CLIs receive it as an env var when spawned via PTY. Token storage is the
// same SQLite file the server's `app_settings` table uses, so whichever process
// writes first wins — INSERT OR IGNORE makes that race-safe.

const API_TOKEN_KEY = "api_token";

let _db: Database.Database | null = null;

// The DB stores the API bearer token + sandbox pairing tokens in cleartext;
// created with default perms it is world-readable. Lock it (and the WAL/SHM
// sidecars) to owner-only. Best-effort — a no-op on non-POSIX filesystems.
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
  // Wait (up to 5s) for a concurrent checkpoint/writer instead of throwing
  // SQLITE_BUSY the instant the server process holds the write lock.
  db.pragma("busy_timeout = 5000");
  restrictDbFilePermissions(dbPath);
  // The server's ensureSchema() owns the canonical table layout; this CREATE
  // IF NOT EXISTS matches the server definition so a first IPC call before the
  // server has bootstrapped still finds the row to read from.
  db.exec(
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  );
  _db = db;
  return db;
}

function readToken(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(API_TOKEN_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function getOrCreateApiToken(userDataDir: string): string {
  const db = openDb(userDataDir);
  const existing = readToken(db);
  if (existing) return existing;
  // INSERT OR IGNORE so a concurrent server write doesn't get clobbered; then
  // re-SELECT to read whichever value won.
  const fresh = generateToken();
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  ).run(API_TOKEN_KEY, fresh);
  return readToken(db) ?? fresh;
}

export function regenerateApiToken(userDataDir: string): string {
  const db = openDb(userDataDir);
  const fresh = generateToken();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(API_TOKEN_KEY, fresh);
  return fresh;
}

export function disposeApiTokenStore(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* best effort */
    }
    _db = null;
  }
}
