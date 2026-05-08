import * as os from "node:os";
import { ensureInstallInfo } from "./install-id";

const DEFAULT_ACADEMY_BASE_URL =
  process.env.VITE_ACADEMY_BASE_URL ??
  process.env.ACADEMY_BASE_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://agentsystem.dev");

export type TelemetryEventType = "app_launch" | "session_started";

/**
 * Fire-and-forget telemetry from the Electron main process.
 *
 * Hard contract: never throws, never blocks, never retries. If anything goes
 * wrong (no internet, academy down, malformed config), the failure is
 * swallowed and the app continues unaffected.
 */
export function sendTelemetry(
  eventType: TelemetryEventType,
  appVersion: string
): void {
  try {
    const info = ensureInstallInfo(appVersion);
    if (!info) return;

    const url = `${DEFAULT_ACADEMY_BASE_URL.replace(/\/$/, "")}/api/telemetry`;
    const body = JSON.stringify({
      eventType,
      installId: info.installId,
      appVersion: info.appVersion,
      osPlatform: process.platform,
      osRelease: os.release(),
    });

    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {
      // intentionally swallowed
    });
  } catch {
    // intentionally swallowed
  }
}
