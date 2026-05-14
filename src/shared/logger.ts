/**
 * Thin structured JSON logger for Mission Control.
 *
 * Zero deps. Works in Electron main and the server (no DOM/React).
 * Writes one JSON line per call to stderr.
 *
 * Level gating via env var MC_LOG_LEVEL (default "info").
 *
 * Field names matching /(token|secret|password|authorization|bearer|api[_-]?key|license[_-]?key)/i
 * are auto-redacted to "[redacted]" so we never leak secrets through logs.
 * String values are also scrubbed for `Bearer <token>` substrings.
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

const REDACT_KEY_RE =
  /(token|secret|password|authorization|bearer|api[_-]?key|license[_-]?key)/i;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;
const SECRET_ASSIGNMENT_RE =
  /\b(token|secret|password|api[_-]?key|license[_-]?key)\b\s*[:=]\s*[^,\s;]+/gi;
const SECRET_PHRASE_RE =
  /\b(token|secret|password|api[_-]?key|license[_-]?key)\b(?:\s+[^,\s;:]+){1,4}/gi;
const REDACTED = "[redacted]";

function scrubString(s: string): string {
  return s
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(SECRET_ASSIGNMENT_RE, "$1=[REDACTED]")
    .replace(SECRET_PHRASE_RE, "$1 [REDACTED]");
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
    return {
      message: scrubString(err.message),
      stack: err.stack ? scrubString(err.stack) : undefined,
      name: err.name,
    };
  }
  return err;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT_KEY_RE.test(key) ? REDACTED : sanitizeValue(nested, seen);
  }
  return out;
}

function sanitizeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  const seen = new WeakSet<object>();
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEY_RE.test(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (k === "err") {
      out[k] = serializeError(v);
      continue;
    }
    out[k] = sanitizeValue(v, seen);
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
