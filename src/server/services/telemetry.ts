import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { academyUrl } from "~/shared/academy";

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
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.installId === "string" &&
      typeof parsed.appVersion === "string" &&
      parsed.installId.length > 0 &&
      parsed.appVersion.length > 0
    ) {
      cachedInfo = { installId: parsed.installId, appVersion: parsed.appVersion };
      return cachedInfo;
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

    const url = academyUrl("/api/telemetry");
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
