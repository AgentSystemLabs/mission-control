// Cross-process allowlist for native dialog-picked directories.
//
// The Electron main process opens a directory picker and appends the chosen
// absolute path here with a short TTL. The server process (which actually
// performs filesystem writes for /api/launch-kit/projects) reads this file
// and refuses any parentDir that wasn't recently issued by the picker.
//
// Persisting via a small JSON file (instead of an in-memory Set) is required
// because the picker lives in the Electron main process but the writer lives
// in the spawned server process.

import * as fs from "node:fs";
import * as path from "node:path";

export const PICKED_DIRS_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FILE_NAME = ".allowed-picked-dirs.json";

type Entry = { path: string; expiresAt: number };

function filePath(userDataDir: string): string {
  return path.join(userDataDir, FILE_NAME);
}

function readAll(userDataDir: string): Entry[] {
  try {
    const raw = fs.readFileSync(filePath(userDataDir), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (e): e is Entry =>
        e &&
        typeof e === "object" &&
        typeof (e as Entry).path === "string" &&
        typeof (e as Entry).expiresAt === "number" &&
        (e as Entry).expiresAt > now,
    );
  } catch {
    return [];
  }
}

function writeAll(userDataDir: string, entries: Entry[]): void {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(filePath(userDataDir), JSON.stringify(entries), {
      mode: 0o600,
    });
  } catch {
    // best-effort
  }
}

export function addPickedDir(
  userDataDir: string,
  absPath: string,
  ttlMs: number = PICKED_DIRS_TTL_MS,
): void {
  const normalized = path.resolve(absPath);
  const now = Date.now();
  const entries = readAll(userDataDir).filter((e) => e.path !== normalized);
  entries.push({ path: normalized, expiresAt: now + ttlMs });
  writeAll(userDataDir, entries);
}

export function isPickedDirAllowed(
  userDataDir: string,
  absPath: string,
): boolean {
  const normalized = path.resolve(absPath);
  const entries = readAll(userDataDir);
  return entries.some((e) => e.path === normalized);
}

export function consumePickedDir(
  userDataDir: string,
  absPath: string,
): boolean {
  const normalized = path.resolve(absPath);
  const entries = readAll(userDataDir);
  const remaining = entries.filter((e) => e.path !== normalized);
  if (remaining.length === entries.length) return false;
  writeAll(userDataDir, remaining);
  return true;
}
