import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session } from "electron";
import log from "electron-log/main";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as nodeNet from "node:net";
import * as os from "node:os";
import { spawn, ChildProcess, spawnSync } from "node:child_process";
import { registerPtyHandlers, killAllPtys } from "./pty-manager";
import { registerFileHandlers, disposeAllFileWatchers } from "./file-handlers";
import { IPC } from "./ipc-channels";
import { augmentProcessEnv, resolveCommandOnPath, sanitizedProcessEnv } from "./shell-env";
import { registerUpdateManager } from "./update-manager";
import {
  clearSessionTerminalDebugLogs,
  listSessionTerminalDebugLogs,
  recordSessionTerminalDebugLog,
  type SessionTerminalDebugLogInput,
} from "./session-terminal-debug-log";
import {
  disposeApiTokenStore,
  getOrCreateApiToken,
  regenerateApiToken,
} from "./api-token-store";
import { configureIpcAllowedOrigins, safeHandle } from "./ipc-safe-handle";
import { configureProjectRootsDb, disposeProjectRootsDb, loadProjectRoots } from "./project-roots";
import { resolveSafeOpenPath } from "./open-path-policy";
import { buildLocalMissionControlApiUrl } from "./pty-hook-env";
import { checkAgentCliVersion } from "./agent-cli-version";
import { AGENT_CLI_VERSION_REQUIREMENTS_BY_COMMAND } from "./agent-cli-version-requirements";

const APP_NAME = "MissionControl";

function defaultUserDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support", APP_NAME);
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData/Roaming", APP_NAME);
  }
  return path.join(home, ".config", APP_NAME);
}

function configureUserDataDir(): string {
  // Keep Electron-side IPC stores aligned with src/db/client.ts. In dev the
  // generated dist-electron/package.json only declares CommonJS, so Electron's
  // package-name-derived default can become "Electron" or "mission-control",
  // splitting API tokens and project roots across separate SQLite files.
  const dir = (process.env.MC_USER_DATA_DIR || defaultUserDataDir()).trim();
  fs.mkdirSync(dir, { recursive: true });
  app.setName(APP_NAME);
  app.setPath("userData", dir);
  process.env.MC_USER_DATA_DIR = dir;
  return dir;
}

const missionControlUserDataDir = configureUserDataDir();

// Persists to ~/Library/Logs/<AppName>/main.log on macOS, %USERPROFILE%/AppData/Roaming/<AppName>/logs/main.log on Windows,
// and ~/.config/<AppName>/logs/main.log on Linux. This is the file users grep when
// the auto-updater goes silent — `console.*` from a packaged Electron app is invisible.
// Log lines may contain the user's local OS username inside artifact paths (e.g. /Users/<name>/Library/...).
// That's already on the user's own machine, so not a privacy risk unless they share the bundle externally.
log.initialize();
log.transports.file.level = "info";
log.transports.console.level = "debug";

const isDev = process.env.NODE_ENV === "development";
const devServerHost = process.env.MC_DEV_HOST ?? "127.0.0.1";
const devServerPort = Number(process.env.MC_DEV_PORT ?? 5173);
const devUrl = process.env.MC_DEV_URL ?? `http://${devServerHost}:${devServerPort}`;

// HTTP readiness polling: wait up to DEV_SERVER_READY_TIMEOUT_MS for the
// server to respond, polling every HTTP_POLL_INTERVAL_MS while waiting.
const DEV_SERVER_READY_TIMEOUT_MS = 30_000;
const HTTP_POLL_INTERVAL_MS = 200;
const GIT_CONFIG_PROBE_TIMEOUT_MS = 2_000;

// Window sizing for the main BrowserWindow.
const MAIN_WINDOW_DEFAULT_WIDTH = 1440;
const MAIN_WINDOW_DEFAULT_HEIGHT = 900;
const MAIN_WINDOW_MIN_WIDTH = 1024;
const MAIN_WINDOW_MIN_HEIGHT = 640;
const TRAFFIC_LIGHT_POSITION_DARWIN = { x: 48, y: 16 } as const;

augmentProcessEnv();

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let runtimePort: number | null = null;

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, devServerHost, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not allocate port")));
      }
    });
  });
}

function waitForHttp(url: string, timeoutMs = DEV_SERVER_READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
    };
    tick();
  });
}

async function openExternalHttpUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!url) return { ok: false, error: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "unsupported-url-scheme" };
  }
  await shell.openExternal(parsed.toString());
  return { ok: true };
}

function configurePermissionHandlers(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
}

async function startProductionServer(): Promise<string> {
  const port = await pickPort();
  const origin = `http://${devServerHost}:${port}`;
  runtimePort = port;
  const portFile = path.join(missionControlUserDataDir, ".port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(port), "utf8");

  const serverEntry = path.join(process.resourcesPath, "app", "dist-server", "server", "server.js");
  const fallbackEntry = path.join(__dirname, "..", "dist-server", "server", "server.js");
  const entry = fs.existsSync(serverEntry) ? serverEntry : fallbackEntry;

  const runner = path.join(__dirname, "server-runner.mjs");

  serverProcess = spawn(process.execPath, [runner], {
    env: {
      ...process.env,
      SERVER_ENTRY: entry,
      PORT: String(port),
      HOST: devServerHost,
      MC_SERVER_ORIGIN: origin,
      MC_DEV_URL: origin,
      MC_DEV_PORT: String(port),
      ELECTRON_RUN_AS_NODE: "1",
      MC_USER_DATA_DIR: missionControlUserDataDir,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  serverProcess.on("exit", (code) => {
    console.error(`[server] exited with code ${code}`);
    if (!(app as any).isQuiting) {
      app.quit();
    }
  });

  await waitForHttp(origin);
  return origin;
}

async function bootDevServer(): Promise<string> {
  // Vite dev server is launched by `pnpm dev:server`; just wait for it.
  await waitForHttp(devUrl);
  runtimePort = Number(new URL(devUrl).port);
  const portFile = path.join(missionControlUserDataDir, ".port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(runtimePort), "utf8");
  return devUrl;
}

async function createWindow() {
  const url = isDev ? await bootDevServer() : await startProductionServer();
  // The renderer is only ever loaded from this URL — pin the IPC allow-list
  // to that origin so a future renderer compromise (XSS in markdown, agent
  // output rendered as HTML, an added webview) can't reach the IPC surface.
  configureIpcAllowedOrigins([url]);

  win = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    backgroundColor: "#000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? TRAFFIC_LIGHT_POSITION_DARWIN : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // Intercept Cmd/Ctrl+W before the default app menu's "Close Window" accelerator
  // closes the BrowserWindow. We forward to the renderer so it can close the
  // focused terminal instead; if nothing claims it, the keystroke is just swallowed.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (mod && !input.shift && !input.alt && input.key.toLowerCase() === "w") {
      event.preventDefault();
      win?.webContents.send(IPC.appCloseIntent);
    }
  });

  // macOS-only: 3-finger swipe (System Settings → Trackpad → More Gestures).
  win.on("swipe", (_e, direction) => {
    win?.webContents.send(IPC.appSwipe, direction);
  });

  win.on("enter-full-screen", () => win?.webContents.send(IPC.appFullScreenChange, true));
  win.on("leave-full-screen", () => win?.webContents.send(IPC.appFullScreenChange, false));
  safeHandle(IPC.appIsFullScreen, () => win?.isFullScreen() ?? false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttpUrl(url);
    return { action: "deny" };
  });

  // A file dropped outside any drop target would otherwise navigate the
  // window to its file:// URL, blowing away the app shell.
  win.webContents.on("will-navigate", (event, navUrl) => {
    if (navUrl !== url) event.preventDefault();
  });

  await win.loadURL(url);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const ALLOWED_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DIRECTORY_GRANTS_FILE = "directory-grants.json";
const DIRECTORY_GRANT_TTL_MS = 15 * 60_000;

function projectImagesDir(): string {
  return path.join(missionControlUserDataDir, "project-images");
}

function registerProjectImageProtocol() {
  protocol.handle("app", async (req) => {
    try {
      const url = new URL(req.url);
      if (url.host !== "project-image") return new Response("not found", { status: 404 });
      const filename = path.basename(decodeURIComponent(url.pathname));
      if (!filename || filename.includes("\0")) return new Response("not found", { status: 404 });
      const ext = path.extname(filename).slice(1).toLowerCase();
      if (!ALLOWED_IMAGE_EXT.has(ext)) return new Response("not found", { status: 404 });
      const dirReal = path.resolve(projectImagesDir());
      const abs = path.resolve(dirReal, filename);
      if (abs !== dirReal && !abs.startsWith(dirReal + path.sep)) {
        return new Response("not found", { status: 404 });
      }
      if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
      return await net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
}

// Tracks paths returned from `dialog:pickImage`. `file:saveProjectImage` will only
// accept a sourcePath that's been issued by us — prevents a compromised renderer
// from copying arbitrary FS paths (e.g. /etc/passwd) into project-images/.
const ALLOWED_PICKED_PATHS = new Set<string>();

function recordPickedDirectoryGrant(dir: string): void {
  const realDir = fs.realpathSync(dir);
  const target = path.join(missionControlUserDataDir, DIRECTORY_GRANTS_FILE);
  let grants: Array<{ path: string; createdAt: number }> = [];
  try {
    const now = Date.now();
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as {
      grants?: Array<{ path?: unknown; createdAt?: unknown }>;
    };
    if (Array.isArray(parsed.grants)) {
      grants = parsed.grants.filter(
        (g): g is { path: string; createdAt: number } =>
          typeof g.path === "string" &&
          typeof g.createdAt === "number" &&
          g.createdAt <= now &&
          now - g.createdAt <= DIRECTORY_GRANT_TTL_MS,
      );
    }
  } catch {
    grants = [];
  }
  grants = grants.filter((g) => path.resolve(g.path) !== path.resolve(realDir));
  grants.push({ path: realDir, createdAt: Date.now() });

  fs.mkdirSync(missionControlUserDataDir, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ grants }, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

safeHandle(IPC.dialogPickImage, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: [...ALLOWED_IMAGE_EXT] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const sourcePath = result.filePaths[0]!;
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return { error: `Unsupported file type: .${ext}` };
  }
  ALLOWED_PICKED_PATHS.add(sourcePath);
  return { sourcePath, extension: ext };
});

safeHandle(
  IPC.fileSaveProjectImage,
  async (_evt, opts: { projectId: string; sourcePath: string; extension: string }) => {
    const { projectId, sourcePath } = opts;
    const ext = opts.extension.toLowerCase();
    if (!projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
      return { error: "invalid projectId" };
    }
    if (!ALLOWED_PICKED_PATHS.has(sourcePath)) {
      return { error: "source not issued by image picker" };
    }
    if (!ALLOWED_IMAGE_EXT.has(ext)) return { error: `unsupported extension: ${ext}` };
    if (!fs.existsSync(sourcePath)) return { error: "source file not found" };
    const stat = fs.statSync(sourcePath);
    if (stat.size > MAX_IMAGE_BYTES) return { error: `image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024}MB` };

    const dir = projectImagesDir();
    fs.mkdirSync(dir, { recursive: true });
    // Sweep any prior file with a different extension for this project.
    for (const name of fs.readdirSync(dir)) {
      if (name.split(".")[0] === projectId) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {}
      }
    }
    const filename = `${projectId}.${ext}`;
    fs.copyFileSync(sourcePath, path.join(dir, filename));
    ALLOWED_PICKED_PATHS.delete(sourcePath);
    return { filename };
  }
);

safeHandle(IPC.dialogBrowseFolder, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0]!;
  try {
    recordPickedDirectoryGrant(selected);
  } catch (err) {
    log.warn("directory-grant.record-failed", { path: selected, error: String(err) });
  }
  return selected;
});

safeHandle(IPC.shellOpenPath, async (_evt, p: string) => {
  const decision = resolveSafeOpenPath(p, loadProjectRoots());
  if (!decision.ok) return decision;
  shell.showItemInFolder(decision.path);
  return { ok: true };
});

safeHandle(IPC.shellOpenExternal, async (_evt, url: string) => {
  return openExternalHttpUrl(url);
});

safeHandle(IPC.appGetRuntimePort, () => runtimePort);
safeHandle(IPC.appGetUserDataDir, () => missionControlUserDataDir);

safeHandle(IPC.appGetUserName, () => {
  try {
    const result = spawnSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      timeout: GIT_CONFIG_PROBE_TIMEOUT_MS,
    });
    const gitName = (result.stdout || "").trim();
    if (gitName) return { source: "git" as const, fullName: gitName, firstName: gitName.split(/\s+/)[0] };
  } catch {}
  const username = os.userInfo().username;
  return { source: "os" as const, fullName: username, firstName: username };
});

safeHandle(IPC.appReload, (event) => {
  const target = BrowserWindow.fromWebContents(event.sender) ?? win;
  if (!target || target.isDestroyed()) {
    return { ok: false as const, error: "window-unavailable" };
  }
  target.reload();
  return { ok: true as const };
});

safeHandle(IPC.cliCheck, (_evt, command: string, opts?: { verifyVersion?: boolean }) => {
  if (!command) return { ok: false, reason: "empty" };
  const env = sanitizedProcessEnv();
  const resolved = resolveCommandOnPath(command, env);
  if (resolved) {
    const requirement = AGENT_CLI_VERSION_REQUIREMENTS_BY_COMMAND[command];
    if (requirement && opts?.verifyVersion) {
      const versionCheck = checkAgentCliVersion(resolved, env, requirement);
      if (!versionCheck.ok) {
        const { output: _output, ...safeVersionCheck } = versionCheck;
        return { ...safeVersionCheck, path: resolved };
      }
      return { ok: true, path: resolved, version: versionCheck.version };
    }
    return { ok: true, path: resolved };
  }
  return { ok: false, reason: "not-found" };
});

registerPtyHandlers(
  ipcMain,
  () => win,
  () => {
    const apiUrl = buildLocalMissionControlApiUrl(runtimePort);
    if (!apiUrl) return null;
    return {
      apiUrl,
      token: getOrCreateApiToken(missionControlUserDataDir),
    };
  },
  () => {
    return runtimePort ? [runtimePort] : [];
  }
);
registerFileHandlers(ipcMain, () => win);

// API bearer token is delivered through IPC only — it must never traverse HTTP
// because the loopback server's same-origin gate doesn't protect against a
// compromised renderer or any other process that can reach the local port.
safeHandle(IPC.settingsGetToken, () => {
  return getOrCreateApiToken(missionControlUserDataDir);
});
safeHandle(IPC.settingsRegenerateToken, () => {
  return regenerateApiToken(missionControlUserDataDir);
});

safeHandle(IPC.debugSessionTerminalLogsList, () => {
  return listSessionTerminalDebugLogs();
});

safeHandle(IPC.debugSessionTerminalLogsClear, () => {
  clearSessionTerminalDebugLogs();
  return { ok: true as const };
});

safeHandle(IPC.debugSessionTerminalLogsRecord, (_evt, input: SessionTerminalDebugLogInput) => {
  return recordSessionTerminalDebugLog({
    ...input,
    source: "renderer",
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  (app as any).isQuiting = true;
  killAllPtys();
  disposeAllFileWatchers();
  disposeApiTokenStore();
  disposeProjectRootsDb();
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(() => {
  // pty:spawn validates `cwd` against this DB before letting any binary run,
  // so it must be configured before any window can issue an IPC call.
  configureProjectRootsDb(missionControlUserDataDir);
  configurePermissionHandlers();
  registerProjectImageProtocol();
  registerUpdateManager(ipcMain, () => win);
  return createWindow();
}).catch((err) => {
  console.error("[main] startup failed:", err);
  app.quit();
});
