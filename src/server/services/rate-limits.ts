import { HTTP_TOO_MANY_REQUESTS } from "~/shared/http-status";
import { jsonError } from "../auth";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult =
  | { ok: true }
  | { ok: false; response: Response };

const buckets = new Map<string, Bucket>();

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number; message?: string },
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true };
  }
  existing.count += 1;
  if (existing.count <= opts.limit) return { ok: true };
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    ok: false,
    response: jsonError(
      HTTP_TOO_MANY_REQUESTS,
      opts.message ?? "rate limit exceeded",
      { "retry-after": String(retryAfter) },
    ),
  };
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  try {
    return new URL(request.url).hostname;
  } catch {
    return "unknown";
  }
}

export function academyAuthRateLimit(request: Request, pathname: string): RateLimitResult {
  return rateLimit(`academy-auth:${requestIp(request)}:${pathname}`, {
    limit: envNumber("MC_AUTH_RATE_LIMIT_PER_MINUTE", 30),
    windowMs: 60_000,
    message: "too many auth attempts",
  });
}

export function hookCallRateLimit(request: Request, taskId: string): RateLimitResult {
  return rateLimit(`hook-call:${requestIp(request)}:${taskId || "no-task"}`, {
    limit: envNumber("MC_HOOK_RATE_LIMIT_PER_MINUTE", 120),
    windowMs: 60_000,
    message: "too many hook calls",
  });
}

export function remotePtySpawnRateLimit(scopeKey: string): RateLimitResult {
  return rateLimit(`remote-pty-spawn:${scopeKey}`, {
    limit: envNumber("MC_REMOTE_PTY_SPAWN_RATE_LIMIT_PER_MINUTE", 10),
    windowMs: 60_000,
    message: "too many remote terminal starts",
  });
}

export function remotePtyWriteRateLimit(scopeKey: string, ptyId: string): RateLimitResult {
  return rateLimit(`remote-pty-write:${scopeKey}:${ptyId}`, {
    limit: envNumber("MC_REMOTE_PTY_WRITE_RATE_LIMIT_PER_MINUTE", 600),
    windowMs: 60_000,
    message: "too many terminal writes",
  });
}

export function resetRateLimitsForTests(): void {
  if (process.env.VITEST) buckets.clear();
}
