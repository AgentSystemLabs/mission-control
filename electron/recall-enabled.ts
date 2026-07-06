import log from "electron-log/main";
import type { PtyHookEnv } from "./pty-hook-env";

// The local API answers in single-digit ms; the cap only bites when the server
// is down mid-restart. Matches the brief fetch in agent-memory-brief.ts.
const SETTINGS_FETCH_TIMEOUT_MS = 1500;

/**
 * Read the live Recall master switch from the local API server, which owns the
 * settings DB — the Electron main process has no direct read. Returns `null`
 * when the server is unreachable or the payload is malformed so callers can
 * fail soft: at session spawn, "unknown" keeps today's provisioning behavior
 * rather than silently stripping tools from a session while the feature is on.
 */
export async function fetchRecallEnabled(mcEnv: PtyHookEnv | null): Promise<boolean | null> {
  if (!mcEnv?.apiUrl || !mcEnv?.token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETTINGS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${mcEnv.apiUrl}/api/settings`, {
      headers: {
        authorization: `Bearer ${mcEnv.token}`,
        "X-Mission-Control-Runtime": "electron-local",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { recallEnabled?: unknown };
    return typeof data.recallEnabled === "boolean" ? data.recallEnabled : null;
  } catch (err) {
    log.warn("recall.settings.fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
