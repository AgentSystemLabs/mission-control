/**
 * Mirror of src/shared/logger.ts for Electron main.
 *
 * The electron/ tsconfig has rootDir = electron, so we can't import from
 * src/. Keep these implementations in sync. Both are tiny, zero-dep, and
 * write a single JSON line per call to stderr.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEY_RE =
  /(token|secret|password|authorization|bearer|api[_-]?key|license[_-]?key)/i;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;
const REDACTED = "[redacted]";

function scrubString(s: string): string {
  return s.replace(BEARER_RE, "Bearer [REDACTED]");
}

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
    if (REDACT_KEY_RE.test(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (k === "err") {
      out[k] = serializeError(v);
      continue;
    }
    out[k] = typeof v === "string" ? scrubString(v) : v;
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
  if (typeof process !== "undefined" && process.stderr?.write) {
    process.stderr.write(line + "\n");
  } else {
     
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
