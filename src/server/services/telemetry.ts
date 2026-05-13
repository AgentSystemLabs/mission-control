import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ACADEMY_BASE_URL } from "~/shared/academy";
import { logger } from "~/shared/logger";

export type TelemetryEventType = "app_launch" | "session_started";

type InstallInfo = { installId: string; appVersion: string };

const INSTALL_FILE = path.join(
  os.homedir(),
  ".mission-control",
  "install.json"
);

let cachedInfo: InstallInfo | null | undefined;

function readInstallInfo(): InstallInfo | null {
  if (cachedInfo !== undefined) return cachedInfo;
  try {
    const raw = fs.readFileSync(INSTALL_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const p = parsed as { installId?: unknown; appVersion?: unknown };
      if (
        typeof p.installId === "string" &&
        typeof p.appVersion === "string" &&
        p.installId.length > 0 &&
        p.appVersion.length > 0
      ) {
        cachedInfo = { installId: p.installId, appVersion: p.appVersion };
        return cachedInfo;
      }
    }
  } catch {
    // file missing or unreadable
  }
  cachedInfo = null;
  return null;
}

/**
 * Fire-and-forget telemetry from the (mission-control internal) server.
 *
 * Hard contract: never throws, never blocks, never retries. If anything goes
 * wrong (install file missing, no internet, academy down), the failure is
 * swallowed and callers continue unaffected.
 */
export function sendTelemetry(eventType: TelemetryEventType): void {
  try {
    const info = readInstallInfo();
    if (!info) return;

    const url = `${ACADEMY_BASE_URL.replace(/\/$/, "")}/api/telemetry`;
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
    }).catch((err) => {
      logger.debug("telemetry dispatch failed", { err });
    });
  } catch (err) {
    logger.debug("telemetry dispatch failed", { err });
  }
}
