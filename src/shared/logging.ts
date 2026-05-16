export type AppLogLevel = "event" | "info" | "success" | "warn" | "error";

export type AppLogCategory = "api" | "session" | "system";

export type AppLogMetadata = Record<string, string | number | boolean | null>;

export type AppLogEntry = {
  id: string;
  at: string;
  timestamp: number;
  level: AppLogLevel;
  category: AppLogCategory;
  message: string;
  metadata?: AppLogMetadata;
};
