import * as os from "node:os";

export type SessionTerminalDebugLogLevel = "error" | "warn";

export type SessionTerminalDebugLogInput = {
  level?: SessionTerminalDebugLogLevel;
  stage: string;
  message: string;
  source?: "pty-manager" | "renderer";
  taskId?: string;
  ptyId?: string;
  agent?: string;
  cwd?: string;
  command?: string;
  exitCode?: number;
  signal?: number | string;
  elapsedMs?: number;
  details?: Record<string, unknown>;
  outputTail?: string;
};

export type SessionTerminalDebugLogEntry = SessionTerminalDebugLogInput & {
  id: string;
  level: SessionTerminalDebugLogLevel;
  source: "pty-manager" | "renderer";
  createdAt: string;
  platform: NodeJS.Platform;
  arch: string;
};

const MAX_ENTRIES = 100;
const MAX_VALUE_LENGTH = 1_000;
const MAX_OUTPUT_TAIL_LENGTH = 6_000;
const MAX_DETAIL_DEPTH = 4;

let entries: SessionTerminalDebugLogEntry[] = [];
let sequence = 0;

function redact(value: string): string {
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[uuid]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|apiToken|access_token|MC_API_TOKEN)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(MC_API_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)=\S+/g, "$1=[redacted]");
}

function truncate(value: string, maxLength = MAX_VALUE_LENGTH): string {
  const clean = redact(value);
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...[truncated]` : clean;
}

function sanitizeTerminalOutput(value: string): string {
  return truncate(
    value
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""),
    MAX_OUTPUT_TAIL_LENGTH,
  );
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > MAX_DETAIL_DEPTH) return "[max-depth]";
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return undefined;
  if (value instanceof Error) {
    return {
      name: truncate(value.name),
      message: truncate(value.message),
      stack: value.stack ? truncate(value.stack, 3_000) : undefined,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeUnknown(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[truncate(key, 120)] = sanitizeUnknown(item, depth + 1);
    }
    return out;
  }
  return truncate(String(value));
}

function sanitizeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  return sanitizeUnknown(details) as Record<string, unknown>;
}

export function recordSessionTerminalDebugLog(
  input: SessionTerminalDebugLogInput,
): SessionTerminalDebugLogEntry {
  const entry: SessionTerminalDebugLogEntry = {
    id: `session-terminal-${Date.now()}-${++sequence}`,
    createdAt: new Date().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    level: input.level ?? "error",
    source: input.source ?? "pty-manager",
    stage: truncate(input.stage, 160),
    message: truncate(input.message, 2_000),
    taskId: input.taskId ? truncate(input.taskId, 200) : undefined,
    ptyId: input.ptyId ? truncate(input.ptyId, 200) : undefined,
    agent: input.agent ? truncate(input.agent, 80) : undefined,
    cwd: input.cwd ? truncate(input.cwd, 1_200) : undefined,
    command: input.command ? truncate(input.command, 1_000) : undefined,
    exitCode: input.exitCode,
    signal: typeof input.signal === "string" ? truncate(input.signal, 80) : input.signal,
    elapsedMs: input.elapsedMs,
    details: sanitizeDetails(input.details),
    outputTail: input.outputTail ? sanitizeTerminalOutput(input.outputTail) : undefined,
  };

  entries = [...entries, entry].slice(-MAX_ENTRIES);
  return entry;
}

export function listSessionTerminalDebugLogs(): SessionTerminalDebugLogEntry[] {
  return [...entries].reverse();
}

export function clearSessionTerminalDebugLogs(): void {
  entries = [];
}

export function __resetSessionTerminalDebugLogForTesting(): void {
  entries = [];
  sequence = 0;
}
