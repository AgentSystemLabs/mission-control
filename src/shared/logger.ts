/**
 * Thin structured JSON logger for Mission Control.
 *
 * Zero deps. Works in Electron main and the server (no DOM/React).
 * Writes one JSON line per call to stderr.
 *
 * Level gating via env var MC_LOG_LEVEL (default "info").
 *
 * Fields named `licenseKey` / `apiToken` / `token` are auto-redacted to
 * "[redacted]" so we never leak secrets through logs.
 *
 * If a field named `err` is an Error, it's serialized as
 * `{ message, stack, name }` (otherwise JSON.stringify would emit `{}`).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEYS = new Set(["licenseKey", "apiToken", "token"]);
const REDACTED = "[redacted]";

function envLevel(): LogLevel {
  const raw = (typeof process !== "undefined" ? process.env?.MC_LOG_LEVEL : "")
    ?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name };
  }
  return err;
}

function sanitizeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (k === "err") {
      out[k] = serializeError(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[envLevel()]) return;
  const record: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    msg,
  };
  const safeFields = sanitizeFields(fields);
  if (safeFields) {
    for (const [k, v] of Object.entries(safeFields)) {
      if (k in record) continue;
      record[k] = v;
    }
  }
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({
      t: record.t,
      level,
      msg,
      _serializeError: "circular or unserializable fields",
    });
  }
  // stderr keeps logs out of stdout protocols (IPC, pipes).
  if (typeof process !== "undefined" && process.stderr?.write) {
    process.stderr.write(line + "\n");
  } else {
    // eslint-disable-next-line no-console
    console.error(line);
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit("error", msg, fields),
};
