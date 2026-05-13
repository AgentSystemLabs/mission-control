import { createHmac, timingSafeEqual } from "node:crypto";
import { getOrCreateApiToken } from "~/db/settings";

/**
 * Per-task scoped capability tokens for spawned agent shells.
 *
 * Every spawned PTY used to receive the global `MC_API_TOKEN` in its env,
 * meaning any child process (npm install postinstall, etc.) could exfiltrate
 * it and gain full API authority. To shrink the blast radius we now issue a
 * per-task HMAC that's only valid on the two endpoints a spawned shell needs:
 *   - POST /api/hooks/:slug  (agent hook callbacks)
 *   - POST /api/tasks/:id/status
 *
 * Token format: `v1.<taskId>.<expiryEpochMs>.<hmacBase64url>`
 * The HMAC is HMAC-SHA256(serverSecret, `${taskId}|${expiry}`). The server
 * secret is the existing API token (treated as the HMAC key — it's already
 * 32 random bytes, never leaves the main process, and rotating it
 * automatically invalidates outstanding task tokens, which is the desired
 * behavior).
 */

const PREFIX = "v1";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function hmacKey(): string {
  return getOrCreateApiToken();
}

function signParts(taskId: string, expiry: number, key: string): string {
  return createHmac("sha256", key)
    .update(`${taskId}|${expiry}`)
    .digest("base64url");
}

export function issueTaskToken(taskId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  if (!taskId) throw new Error("taskId required");
  const expiry = Date.now() + Math.max(0, ttlMs);
  const sig = signParts(taskId, expiry, hmacKey());
  return `${PREFIX}.${taskId}.${expiry}.${sig}`;
}

export type VerifyResult =
  | { ok: true; taskId: string; expiresAt: number }
  | { ok: false; reason: "format" | "task_mismatch" | "expired" | "signature" };

export function verifyTaskToken(
  token: string | null | undefined,
  requiredTaskId: string,
  now: number = Date.now(),
): VerifyResult {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "format" };
  }
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "format" };
  const [prefix, taskId, expiryRaw, sig] = parts as [string, string, string, string];
  if (prefix !== PREFIX || !taskId || !expiryRaw || !sig) {
    return { ok: false, reason: "format" };
  }
  if (taskId !== requiredTaskId) {
    return { ok: false, reason: "task_mismatch" };
  }
  const expiry = Number.parseInt(expiryRaw, 10);
  if (!Number.isFinite(expiry) || String(expiry) !== expiryRaw) {
    return { ok: false, reason: "format" };
  }
  if (expiry <= now) {
    return { ok: false, reason: "expired" };
  }

  const expected = signParts(taskId, expiry, hmacKey());
  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "base64url");
    actualBuf = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (expectedBuf.length !== actualBuf.length) {
    return { ok: false, reason: "signature" };
  }
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "signature" };
  }
  return { ok: true, taskId, expiresAt: expiry };
}
