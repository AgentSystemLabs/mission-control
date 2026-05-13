import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

export type InstallInfo = {
  installId: string;
  appVersion: string;
};

const DIR = path.join(os.homedir(), ".mission-control");
const FILE = path.join(DIR, "install.json");

function readFileSafe(): Partial<InstallInfo> | null {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    const out: Partial<InstallInfo> = {};
    if (typeof p.installId === "string") out.installId = p.installId;
    if (typeof p.appVersion === "string") out.appVersion = p.appVersion;
    return out;
  } catch {
    // missing or unreadable — caller will recreate
  }
  return null;
}

function writeFileSafe(info: InstallInfo): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(info, null, 2), "utf8");
  } catch {
    // best-effort; telemetry is fire-and-forget
  }
}

/**
 * Ensure an install.json exists at ~/.mission-control/install.json with a
 * stable installId and the current appVersion. Returns null if persistence
 * fails — callers must skip telemetry in that case (no crash, no retry).
 */
export function ensureInstallInfo(appVersion: string): InstallInfo | null {
  const existing = readFileSafe();
  if (existing?.installId) {
    if (existing.appVersion !== appVersion) {
      writeFileSafe({ installId: existing.installId, appVersion });
    }
    return { installId: existing.installId, appVersion };
  }
  const info: InstallInfo = {
    installId: crypto.randomUUID(),
    appVersion,
  };
  writeFileSafe(info);
  return readFileSafe()?.installId ? info : null;
}

/**
 * Read-only accessor used by the (renderer-side) server. Returns null if the
 * file hasn't been initialized yet — caller swallows.
 */
export function readInstallInfo(): InstallInfo | null {
  const existing = readFileSafe();
  if (existing?.installId && existing?.appVersion) {
    return { installId: existing.installId, appVersion: existing.appVersion };
  }
  return null;
}
