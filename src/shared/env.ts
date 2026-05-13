/**
 * Centralized environment parsing and validation.
 *
 * Two flavors:
 *   - `env`         — browser-safe public vars (renderer + shared code).
 *                     Only includes values that are safe to ship in the
 *                     client bundle (host, port, public URLs).
 *   - `serverEnv()` — Node/Electron-main only. Includes secrets and
 *                     filesystem paths. Throws if called from a browser
 *                     context so a stray import surfaces immediately.
 *
 * Both run their zod schema lazily on first access and cache the result.
 * Validation failures throw at the call site with a clear list of issues,
 * so misconfig fails fast at boot rather than silently producing NaN or
 * undefined deep inside a code path.
 */
import { z } from "zod";

// ---- helpers --------------------------------------------------------------

const optionalNonEmpty = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalPort = z
  .union([
    z.coerce.number().int().positive().max(65535),
    z.literal("").transform(() => undefined),
  ])
  .optional();

const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalPath = z
  .string()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

function rawEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) return {};
  return process.env as Record<string, string | undefined>;
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

// ---- public (browser-safe) env -------------------------------------------

const PublicEnvSchema = z.object({
  MC_DEV_HOST: optionalNonEmpty,
  MC_DEV_PORT: optionalPort,
  MC_DEV_URL: optionalUrl,
  MC_SERVER_ORIGIN: optionalUrl,
  MC_API_URL: optionalUrl,
  VITE_ACADEMY_BASE_URL: optionalUrl,
  NODE_ENV: optionalNonEmpty,
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

let _env: Readonly<PublicEnv> | null = null;

export function getEnv(): Readonly<PublicEnv> {
  if (_env) return _env;
  const src = rawEnv();
  const parsed = PublicEnvSchema.safeParse({
    MC_DEV_HOST: src.MC_DEV_HOST,
    MC_DEV_PORT: src.MC_DEV_PORT,
    MC_DEV_URL: src.MC_DEV_URL,
    MC_SERVER_ORIGIN: src.MC_SERVER_ORIGIN,
    MC_API_URL: src.MC_API_URL,
    VITE_ACADEMY_BASE_URL: src.VITE_ACADEMY_BASE_URL,
    NODE_ENV: src.NODE_ENV,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment variables:\n${formatIssues(parsed.error)}`,
    );
  }
  _env = Object.freeze(parsed.data);
  return _env;
}

/** Eager accessor for ergonomic call sites: `env.MC_DEV_HOST`. */
export const env: Readonly<PublicEnv> = new Proxy({} as PublicEnv, {
  get(_t, prop: string) {
    return getEnv()[prop as keyof PublicEnv];
  },
}) as Readonly<PublicEnv>;

// ---- server-only env ------------------------------------------------------

const ServerEnvSchema = z.object({
  // license verification
  MC_LICENSE_PUBLIC_KEY: optionalNonEmpty,
  // sqlite location (overrides platform default)
  MC_USER_DATA_DIR: optionalPath,
  // academy skills bundle base URL (server-side override)
  ACADEMY_BASE_URL: optionalUrl,
  VITE_ACADEMY_BASE_URL: optionalUrl,
  // node runtime
  NODE_ENV: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let _serverEnv: Readonly<ServerEnv> | null = null;

export function serverEnv(): Readonly<ServerEnv> {
  if (_serverEnv) return _serverEnv;
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv() called from a browser context — server-only env must not be imported into renderer code.",
    );
  }
  const src = rawEnv();
  const parsed = ServerEnvSchema.safeParse({
    MC_LICENSE_PUBLIC_KEY: src.MC_LICENSE_PUBLIC_KEY,
    MC_USER_DATA_DIR: src.MC_USER_DATA_DIR,
    ACADEMY_BASE_URL: src.ACADEMY_BASE_URL,
    VITE_ACADEMY_BASE_URL: src.VITE_ACADEMY_BASE_URL,
    NODE_ENV: src.NODE_ENV,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${formatIssues(parsed.error)}`,
    );
  }
  _serverEnv = Object.freeze(parsed.data);
  return _serverEnv;
}

/** Test-only: reset cached env so tests can mutate process.env between cases. */
export function __resetEnvCacheForTests(): void {
  _env = null;
  _serverEnv = null;
}
