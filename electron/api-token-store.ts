import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { closeQuietly, ensureAppSettingsTable, openMissionControlDb } from "./mission-control-db";

// The api bearer token never crosses HTTP. Renderer and main hold it; external
// CLIs receive it as an env var when spawned via PTY. Token storage is the
// same SQLite file the server's `app_settings` table uses, so whichever process
// writes first wins — INSERT OR IGNORE makes that race-safe.

const API_TOKEN_KEY = "api_token";

let _db: Database.Database | null = null;

function openDb(userDataDir: string): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  const db = openMissionControlDb(userDataDir);
  ensureAppSettingsTable(db);
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
  closeQuietly(_db);
  _db = null;
}
