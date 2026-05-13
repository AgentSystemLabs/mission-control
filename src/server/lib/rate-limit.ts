/**
 * Minimal in-memory rate limiter (fixed-window) for protecting sensitive
 * endpoints from accidental hammering. Map-based, no deps. Sufficient for a
 * single-process desktop app where requests come from the local renderer.
 *
 * Each named bucket holds at most `MAX_KEYS` keys; LRU-ish eviction prunes the
 * oldest expired entries when the map fills, so a misbehaving client can't
 * grow it unbounded.
 */
const MAX_KEYS = 1024;

type Bucket = {
  windowMs: number;
  max: number;
  entries: Map<string, { count: number; resetAt: number }>;
};

const buckets = new Map<string, Bucket>();

export function rateLimit(
  bucketName: string,
  key: string,
  options: { max: number; windowMs: number },
): { ok: true } | { ok: false; retryAfterSec: number } {
  let bucket = buckets.get(bucketName);
  if (!bucket) {
    bucket = { windowMs: options.windowMs, max: options.max, entries: new Map() };
    buckets.set(bucketName, bucket);
  }
  // Allow live tuning if the caller changes limits between calls.
  bucket.windowMs = options.windowMs;
  bucket.max = options.max;

  const now = Date.now();
  const entry = bucket.entries.get(key);
  if (!entry || entry.resetAt <= now) {
    if (bucket.entries.size >= MAX_KEYS) evictExpired(bucket, now);
    bucket.entries.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true };
  }
  if (entry.count >= options.max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { ok: true };
}

function evictExpired(bucket: Bucket, now: number): void {
  for (const [k, v] of bucket.entries) {
    if (v.resetAt <= now) bucket.entries.delete(k);
  }
  // If still full, drop the single oldest (smallest resetAt) entry so the map
  // can't grow unbounded under sustained pressure from a unique-key flood.
  if (bucket.entries.size >= MAX_KEYS) {
    let oldestKey: string | null = null;
    let oldestResetAt = Infinity;
    for (const [k, v] of bucket.entries) {
      if (v.resetAt < oldestResetAt) {
        oldestResetAt = v.resetAt;
        oldestKey = k;
      }
    }
    if (oldestKey) bucket.entries.delete(oldestKey);
  }
}

/**
 * Extract a stable client key from a Web Request. Prefers x-forwarded-for,
 * then x-real-ip, then a stable bearer-token fingerprint, then "local".
 */
export function clientKeyFromRequest(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) {
    const tok = m[1];
    // Cheap fingerprint so we don't keep the raw token in memory keys.
    return `tok:${tok.length}:${tok.slice(0, 4)}:${tok.slice(-4)}`;
  }
  return "local";
}

export function rateLimitResponse(
  retryAfterSec: number,
  message = "Too many requests",
): Response {
  return new Response(
    JSON.stringify({ error: message, code: "rate_limited" }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfterSec),
      },
    },
  );
}

/** Test-only: clear all buckets. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
