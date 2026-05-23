import type { BrowserWindow, IpcMain } from "electron";
import { app } from "electron";
import log from "electron-log/main";
import { getBooleanAppSetting } from "./app-settings-store";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";

// Logs: stdout (dev) | ~/Library/Logs/<AppName>/main.log (mac prod) | platform-equivalents elsewhere.
// Event prefixes used in this file: `update.load.*`, `update.check.*`, `update.download.*`,
// `update.install.*`, `update.state.*`, `update.error.*`. See docs/observability.md.

// electron-updater is loaded lazily so that dev (where the package is still installed
// but autoUpdater would throw on isPackaged=false) doesn't pay the import cost or
// pull native bits before we've checked the guard.
type ElectronUpdater = typeof import("electron-updater");
type AutoUpdater = ElectronUpdater["autoUpdater"];

export type UpdateState =
  | { kind: "unsupported-dev" }
  | { kind: "idle"; lastCheckedAt: number | null }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { kind: "ready-to-install"; version: string }
  | { kind: "error"; message: string };

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const UPDATE_STARTUP_DELAY_MS = 10_000;
const AUTOMATIC_UPDATE_DOWNLOADS_SETTING_KEY = "automatic_update_downloads_enabled";
const AUTOMATIC_UPDATE_INSTALL_ON_QUIT_SETTING_KEY = "automatic_update_install_on_quit_enabled";
const DEFAULT_AUTOMATIC_UPDATE_DOWNLOADS_ENABLED = false;
const DEFAULT_AUTOMATIC_UPDATE_INSTALL_ON_QUIT_ENABLED = false;

// download-progress fires roughly every second. We only want a log entry at
// monotonically-increasing 10% boundaries so the trail tells us "got to 30%, 40%,
// 50%" rather than spamming once a second.
const PROGRESS_LOG_STEP = 10;
let lastLoggedProgressBucket = -1;

let currentState: UpdateState = app.isPackaged
  ? { kind: "idle", lastCheckedAt: null }
  : { kind: "unsupported-dev" };

let updater: AutoUpdater | null = null;
let getWindow: (() => BrowserWindow | null) | null = null;
let userDataDir: string | null = null;
let initialized = false;
let eventsWired = false;
let pendingUpdateVersion: string | null = null;

function broadcast(next: UpdateState) {
  const prev = currentState;
  currentState = next;

  if (next.kind === "downloading") {
    // Reset bucket when we re-enter downloading (e.g. retry).
    if (prev.kind !== "downloading") lastLoggedProgressBucket = -1;
    const bucket = Math.floor(next.percent / PROGRESS_LOG_STEP);
    if (bucket > lastLoggedProgressBucket) {
      lastLoggedProgressBucket = bucket;
      log.info("update.state.transition", {
        event: "update.state.transition",
        from: prev.kind,
        to: next.kind,
        version: next.version,
        percent: bucket * PROGRESS_LOG_STEP,
        bytesPerSecond: next.bytesPerSecond,
      });
    }
  } else if (prev.kind !== next.kind) {
    // All non-progress transitions are logged once each.
    log.info("update.state.transition", {
      event: "update.state.transition",
      from: prev.kind,
      to: next.kind,
      ...("version" in next ? { version: next.version } : {}),
      ...("message" in next ? { message: next.message } : {}),
    });
  }

  const win = getWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.updateStateChange, next);
  }
}

// Returns a short, single-line, length-capped string safe to broadcast to the
// renderer. Deliberately drops err.stack, err.cause, and JSON.stringify(err) so
// we don't leak filesystem paths, response bodies, or signature-check stderr
// into the DOM. The full error is logged separately on the main side.
function describeError(err: unknown): string {
  let raw: string;
  if (err instanceof Error) raw = err.message || err.name || "update error";
  else if (typeof err === "string") raw = err;
  else raw = "unknown update error";
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "update error";
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine;
}

function logMainError(event: string, err: unknown): void {
  // Full error object (stack, cause, code, etc.) stays on the main side only.
  // electron-log handles Error instances natively — stack + name + message are
  // serialized into the log file. The renderer gets only the short, sanitized
  // string via describeError above.
  const errPayload =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack, code: (err as NodeJS.ErrnoException).code }
      : { value: String(err) };
  log.error(event, {
    event,
    err: errPayload,
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });
  // Preserve dev-console visibility.
  console.error(`[update-manager] ${event}:`, err);
}

function readBooleanSetting(key: string, defaultValue: boolean): boolean {
  if (!userDataDir) return defaultValue;
  return getBooleanAppSetting(userDataDir, key, defaultValue);
}

function applyUpdaterPreferences(au: AutoUpdater): {
  automaticDownloadEnabled: boolean;
  automaticInstallOnQuitEnabled: boolean;
} {
  const automaticDownloadEnabled = readBooleanSetting(
    AUTOMATIC_UPDATE_DOWNLOADS_SETTING_KEY,
    DEFAULT_AUTOMATIC_UPDATE_DOWNLOADS_ENABLED,
  );
  const automaticInstallOnQuitEnabled = readBooleanSetting(
    AUTOMATIC_UPDATE_INSTALL_ON_QUIT_SETTING_KEY,
    DEFAULT_AUTOMATIC_UPDATE_INSTALL_ON_QUIT_ENABLED,
  );
  au.autoDownload = automaticDownloadEnabled;
  au.autoInstallOnAppQuit = automaticInstallOnQuitEnabled;
  return { automaticDownloadEnabled, automaticInstallOnQuitEnabled };
}

function wireEvents(au: AutoUpdater) {
  // Route electron-updater's internal log stream (URL resolution, signature
  // verification, partial-content retries, differential-download fallback) into
  // the same persistent file. This is the single most valuable line for
  // debugging silent auto-update failures on macOS (notarization mismatches,
  // signing differences between dev and shipped builds).
  au.logger = log;
  au.allowDowngrade = false;
  applyUpdaterPreferences(au);

  au.on("checking-for-update", () => {
    broadcast({ kind: "checking" });
  });

  au.on("update-available", (info: { version?: string }) => {
    const version = info?.version ?? "unknown";
    pendingUpdateVersion = version;
    log.info("update.check.available", {
      event: "update.check.available",
      version,
      automaticDownloadEnabled: au.autoDownload,
    });
    // When auto-download is on, electron-updater starts immediately — skip the
    // transient `available` state so the UI doesn't flash a Download CTA.
    if (!au.autoDownload) {
      broadcast({ kind: "available", version });
    }
  });

  au.on("update-not-available", () => {
    pendingUpdateVersion = null;
    broadcast({ kind: "idle", lastCheckedAt: Date.now() });
  });

  au.on("download-progress", (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
    const version =
      pendingUpdateVersion ??
      (currentState.kind === "downloading" || currentState.kind === "available"
        ? (currentState as Extract<UpdateState, { version: string }>).version
        : "unknown");
    broadcast({
      kind: "downloading",
      version,
      percent: Math.max(0, Math.min(100, p.percent ?? 0)),
      bytesPerSecond: p.bytesPerSecond ?? 0,
      transferred: p.transferred ?? 0,
      total: p.total ?? 0,
    });
  });

  au.on("update-downloaded", (info: { version?: string }) => {
    pendingUpdateVersion = null;
    broadcast({ kind: "ready-to-install", version: info?.version ?? "unknown" });
  });

  au.on("error", (err: Error) => {
    logMainError("update.error.received", err);
    broadcast({ kind: "error", message: describeError(err) });
  });
}

function ensureEventsWired(au: AutoUpdater): void {
  if (eventsWired) return;
  eventsWired = true;
  wireEvents(au);
}

async function loadUpdater(): Promise<AutoUpdater | null> {
  if (updater) {
    ensureEventsWired(updater);
    return updater;
  }
  try {
    // Dynamic import keeps dev startup fast and lets us no-op if the dep is missing.
    const mod = (await import("electron-updater")) as ElectronUpdater;
    updater = mod.autoUpdater;
    ensureEventsWired(updater);
    return updater;
  } catch (err) {
    logMainError("update.load.failed", err);
    broadcast({ kind: "error", message: describeError(err) });
    return null;
  }
}

type CheckTrigger = "startup" | "interval" | "ipc";

async function safeCheck(trigger: CheckTrigger = "ipc"): Promise<void> {
  if (!app.isPackaged) return;
  const au = await loadUpdater();
  if (!au) return;
  const prefs = applyUpdaterPreferences(au);
  log.info("update.check.started", {
    event: "update.check.started",
    trigger,
    currentVersion: app.getVersion(),
    ...prefs,
  });
  try {
    await au.checkForUpdates();
  } catch (err) {
    logMainError("update.check.failed", err);
    broadcast({ kind: "error", message: describeError(err) });
  }
}

async function safeDownload(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!app.isPackaged) return { ok: false, error: "not-packaged" };
  const au = await loadUpdater();
  if (!au) return { ok: false, error: "updater-unavailable" };
  applyUpdaterPreferences(au);
  if (currentState.kind === "downloading" || currentState.kind === "ready-to-install") {
    log.info("update.download.skipped", {
      event: "update.download.skipped",
      reason: currentState.kind,
    });
    return { ok: true };
  }
  if (currentState.kind !== "available") {
    log.info("update.download.skipped", {
      event: "update.download.skipped",
      reason: currentState.kind,
    });
    return { ok: false, error: "no-update-available" };
  }
  const version = currentState.version;
  log.info("update.download.started", {
    event: "update.download.started",
    currentVersion: app.getVersion(),
    version,
  });
  try {
    pendingUpdateVersion = version;
    broadcast({
      kind: "downloading",
      version,
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
    });
    await au.downloadUpdate();
    return { ok: true };
  } catch (err) {
    logMainError("update.download.failed", err);
    const message = describeError(err);
    broadcast({ kind: "error", message });
    return { ok: false, error: message };
  }
}

function safeInstall(): { ok: true } | { ok: false; error: string } {
  if (!app.isPackaged) return { ok: false, error: "not-packaged" };
  if (!updater) return { ok: false, error: "updater-not-loaded" };
  log.info("update.install.requested", {
    event: "update.install.requested",
    currentVersion: app.getVersion(),
  });
  try {
    // isSilent=false, isForceRunAfter=true → quit, install, relaunch.
    updater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    logMainError("update.install.failed", err);
    const message = describeError(err);
    broadcast({ kind: "error", message });
    return { ok: false, error: message };
  }
}

export function registerUpdateManager(
  ipcMain: IpcMain,
  windowAccessor: () => BrowserWindow | null,
  appUserDataDir: string,
) {
  if (initialized) return;
  initialized = true;
  getWindow = windowAccessor;
  userDataDir = appUserDataDir;

  safeHandle(IPC.updateGetState, () => currentState, ipcMain);
  safeHandle(IPC.updateCheck, () => safeCheck("ipc"), ipcMain);
  safeHandle(IPC.updateDownload, () => safeDownload(), ipcMain);
  safeHandle(IPC.updateInstall, () => safeInstall(), ipcMain);

  if (!app.isPackaged) {
    // Stay in unsupported-dev. autoUpdater is intentionally not loaded.
    return;
  }

  app.on("before-quit", () => {
    if (updater) applyUpdaterPreferences(updater);
  });

  // Initial check shortly after app ready; then periodically.
  setTimeout(() => void safeCheck("startup"), UPDATE_STARTUP_DELAY_MS);
  setInterval(() => void safeCheck("interval"), UPDATE_CHECK_INTERVAL_MS);

  // TODO(academy auto-update infra): this only activates once academy serves the
  // generic-provider artifacts (latest-mac.yml, latest.yml, latest-linux.yml,
  // *.blockmap, *.zip) at https://agentsystem.dev/downloads/mission-control/auto-update.
  // Until then autoUpdater will report `error` here and the renderer falls back to
  // openExternal(downloadUrl).
}
