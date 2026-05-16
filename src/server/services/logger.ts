import { events } from "../events";
import type {
  AppLogCategory,
  AppLogEntry,
  AppLogLevel,
  AppLogMetadata,
} from "~/shared/logging";

const MAX_LOGS = 1_000;

let logs: AppLogEntry[] = [];
let sequence = 0;

function nextId(timestamp: number): string {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return `log-${timestamp.toString(36)}-${sequence.toString(36)}`;
}

function cleanMetadata(metadata?: AppLogMetadata): AppLogMetadata | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function recordLog(input: {
  level: AppLogLevel;
  category: AppLogCategory;
  message: string;
  metadata?: AppLogMetadata;
}): AppLogEntry {
  const timestamp = Date.now();
  const entry: AppLogEntry = {
    id: nextId(timestamp),
    at: new Date(timestamp).toISOString(),
    timestamp,
    level: input.level,
    category: input.category,
    message: input.message,
    metadata: cleanMetadata(input.metadata),
  };

  logs = [entry, ...logs].slice(0, MAX_LOGS);
  events.emit("log:created", { entry });
  return entry;
}

export function listLogs(limit = MAX_LOGS): AppLogEntry[] {
  const safeLimit = Math.max(1, Math.min(MAX_LOGS, Math.floor(limit) || MAX_LOGS));
  return logs.slice(0, safeLimit);
}

export function clearLogs() {
  logs = [];
}

export const appLogger = {
  event: (category: AppLogCategory, message: string, metadata?: AppLogMetadata) =>
    recordLog({ level: "event", category, message, metadata }),
  info: (category: AppLogCategory, message: string, metadata?: AppLogMetadata) =>
    recordLog({ level: "info", category, message, metadata }),
  success: (category: AppLogCategory, message: string, metadata?: AppLogMetadata) =>
    recordLog({ level: "success", category, message, metadata }),
  warn: (category: AppLogCategory, message: string, metadata?: AppLogMetadata) =>
    recordLog({ level: "warn", category, message, metadata }),
  error: (category: AppLogCategory, message: string, metadata?: AppLogMetadata) =>
    recordLog({ level: "error", category, message, metadata }),
};
