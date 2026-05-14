import * as fs from "node:fs";
import * as path from "node:path";
import { getOrCreateApiToken } from "~/db/settings";
import { resolveUserDataDir } from "~/db/client";
import { serverEnv } from "~/shared/env";

let cached: string | null = null;

function writeTokenFile(token: string): void {
  try {
    const dir = resolveUserDataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".api-token"), token, { mode: 0o600 });
  } catch {
    // best-effort; main process retries
  }
}

export function ensureApiTokenBootstrap(): string {
  if (cached) return cached;
  const token = getOrCreateApiToken();
  cached = token;
  process.env.MC_API_TOKEN = token;
  writeTokenFile(token);
  return token;
}

export function ensureLocalApiTokenBootstrap(): string | null {
  const cloudMode = serverEnv().MC_CLOUD_MODE;
  if (cloudMode === "1" || cloudMode === "true" || cloudMode === "yes") {
    return null;
  }
  return ensureApiTokenBootstrap();
}

export function refreshApiTokenAfterRegenerate(token: string): void {
  cached = token;
  process.env.MC_API_TOKEN = token;
  writeTokenFile(token);
}
