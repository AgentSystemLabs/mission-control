import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from "electron";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as nodeNet from "node:net";
import * as os from "node:os";
import { spawn, ChildProcess, spawnSync } from "node:child_process";
import { registerPtyHandlers, killAllPtys } from "./pty-manager";
import { registerFileHandlers, disposeAllFileWatchers, resolveInsideRoot } from "./file-handlers";
import { IPC } from "./ipc-channels";
import { installSkills, fetchLatestSkillsManifest } from "./install-skills";
import { sendTelemetry } from "./telemetry";
import { augmentProcessEnv, resolveCommandOnPath, sanitizedProcessEnv } from "./shell-env";
import { logger } from "./logger";
import { env, serverEnv } from "../src/shared/env";

// Boot-time validation: fail fast on misconfig before anything else runs.
serverEnv();

const isDev = env.NODE_ENV === "development";
const devServerHost = env.MC_DEV_HOST ?? "127.0.0.1";
const devServerPort = env.MC_DEV_PORT ?? 5173;
const devUrl = env.MC_DEV_URL ?? `http://${devServerHost}:${devServerPort}`;

augmentProcessEnv();

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let runtimePort: number | null = null;
let isQuiting = false;

// Cache renderer-supplied projectId → server-stored absolute path with a short
// TTL. The renderer can't lie about which path belongs to a projectId because
// resolution happens against the SQLite-backed API, not against renderer input.
const PROJECT_PATH_TTL_MS = 30_000;
type CachedPath = { path: string; expiresAt: number };
const projectPathCache = new Map<string, CachedPath>();
const projectPathInFlight = new Map<string, Promise<string | null>>();

function platformDefaultUserDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library/Application Support/MissionControl");
  if (process.platform === "win32") return path.join(home, "AppData/Roaming/MissionControl");
  return path.join(home, ".config/MissionControl");
}

function readApiTokenFromFile(): string | null {
  const candidates = [
    path.join(app.getPath("userData"), ".api-token"),
    path.join(platformDefaultUserDataDir(), ".api-token"),
  ];
  for (const file of candidates) {
    try {
      const t = fs.readFileSync(file, "utf8").trim();
      if (t) return t;
    } catch {
      // try next
    }
  }
  return null;
}

export async function getProjectPath(projectId: string): Promise<string | null> {
  if (!projectId || typeof projectId !== "string") return null;
  // Defense in depth: the path will still be symlink-real-path-checked by the
  // callers; this only guards against the projectId itself being garbage.
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) return null;
  const now = Date.now();
  const cached = projectPathCache.get(projectId);
  if (cached && cached.expiresAt > now) return cached.path;
  const existing = projectPathInFlight.get(projectId);
  if (existing) return existing;
  if (!runtimePort) return null;
  const token = readApiTokenFromFile();
  if (!token) return null;
  const lookup = (async (): Promise<string | null> => {
    try {
      const res = await fetch(
        `http://${devServerHost}:${runtimePort}/api/projects/${encodeURIComponent(projectId)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { project?: { path?: string } };
      const p = body?.project?.path;
      if (!p || typeof p !== "string") return null;
      projectPathCache.set(projectId, { path: p, expiresAt: Date.now() + PROJECT_PATH_TTL_MS });
      return p;
    } catch (err) {
      logger.warn("getProjectPath failed", { err, op: "project.resolve", projectId });
      return null;
    } finally {
      projectPathInFlight.delete(projectId);
    }
  })();
  projectPathInFlight.set(projectId, lookup);
  return lookup;
}

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

function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, 200);
      });
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, 200);
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

async function startProductionServer(): Promise<string> {
  const port = await pickPort();
  const origin = `http://${devServerHost}:${port}`;
  runtimePort = port;
  const portFile = path.join(app.getPath("userData"), ".port");
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
      MC_USER_DATA_DIR: app.getPath("userData"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  serverProcess.on("exit", (code, signal) => {
    logger.error("server.exit", { code, signal });
    if (!isQuiting) {
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
  const portFile = path.join(app.getPath("userData"), ".port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(runtimePort), "utf8");
  return devUrl;
}

async function createWindow() {
  const url = isDev ? await bootDevServer() : await startProductionServer();

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 48, y: 16 } : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
  ipcMain.handle(IPC.appIsFullScreen, () => win?.isFullScreen() ?? false);
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

function projectImagesDir(): string {
  return path.join(app.getPath("userData"), "project-images");
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

// Sibling allowlist for directories picked via `dialog:pickProjectParentDir`.
// Persisted as a small JSON file in userData so the spawned server process can
// also verify the picked directory before writing to it (the server lives in
// a different process and can't read main's in-memory Set). Entries expire so
// a stale token can't be reused indefinitely.
const PICKED_DIRS_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PICKED_DIRS_FILE = ".allowed-picked-dirs.json";

type PickedDirEntry = { path: string; expiresAt: number };

function pickedDirsFile(): string {
  return path.join(app.getPath("userData"), PICKED_DIRS_FILE);
}

function readPickedDirs(): PickedDirEntry[] {
  try {
    const raw = fs.readFileSync(pickedDirsFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (e: unknown): e is PickedDirEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as PickedDirEntry).path === "string" &&
        typeof (e as PickedDirEntry).expiresAt === "number" &&
        (e as PickedDirEntry).expiresAt > now,
    );
  } catch {
    return [];
  }
}

function addPickedDir(absPath: string): void {
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    const normalized = path.resolve(absPath);
    const now = Date.now();
    const entries = readPickedDirs().filter((e) => e.path !== normalized);
    entries.push({ path: normalized, expiresAt: now + PICKED_DIRS_TTL_MS });
    fs.writeFileSync(pickedDirsFile(), JSON.stringify(entries), { mode: 0o600 });
  } catch {
    // best-effort
  }
}

ipcMain.handle(IPC.dialogPickImage, async () => {
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

ipcMain.handle(
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

ipcMain.handle(IPC.dialogBrowseFolder, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Launch-Kit parent-directory picker. The chosen path is added to a short-TTL
// allowlist that the server-side `/api/launch-kit/projects` handler verifies
// before writing to disk — so a compromised renderer can't post an arbitrary
// absolute path and have the server wipe + replant it.
ipcMain.handle(IPC.dialogPickProjectParentDir, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const picked = result.filePaths[0]!;
  let resolved: string;
  try {
    // Resolve symlinks now so the value we hand to the renderer matches what
    // the server will compare against (the server also realpath's its input).
    resolved = fs.realpathSync(picked);
  } catch {
    resolved = path.resolve(picked);
  }
  addPickedDir(resolved);
  return resolved;
});

// TODO(renderer): renderer-side callers must be updated to pass (projectId, relPath)
// instead of an absolute path. The channel now resolves paths inside the project
// root via the same logic as file-handlers' resolveInsideRoot.
ipcMain.handle(
  IPC.shellOpenPath,
  async (_evt, projectId: string, relPath: string) => {
    if (!projectId || typeof projectId !== "string") {
      return { ok: false as const, error: "invalid-project" };
    }
    if (!relPath || typeof relPath !== "string") {
      return { ok: false as const, error: "empty" };
    }
    const projectRoot = await getProjectPath(projectId);
    if (!projectRoot) return { ok: false as const, error: "unknown-project" };
    const abs = resolveInsideRoot(projectRoot, relPath);
    if (!abs) return { ok: false as const, error: "invalid-path" };
    try {
      const err = await shell.openPath(abs);
      if (err) {
        logger.warn("shell.openPath failed", { err, op: "shell.openPath", path: abs });
        return { ok: false as const, error: err };
      }
      return { ok: true as const };
    } catch (err) {
      logger.warn("shell.openPath failed", { err, op: "shell.openPath", path: abs });
      return { ok: false as const, error: String(err) };
    }
  },
);

ipcMain.handle(IPC.shellOpenExternal, async (_evt, url: string) => {
  try {
    return await openExternalHttpUrl(url);
  } catch (err) {
    logger.warn("shell.openPath failed", { err, op: "shell.openExternal", path: url });
    return { ok: false as const, error: String(err) };
  }
});

ipcMain.handle(IPC.appGetProjectPath, async (_evt, projectId: string) => {
  const p = await getProjectPath(projectId);
  if (!p) return { ok: false as const, error: "unknown-project" as const };
  return { ok: true as const, path: p };
});

ipcMain.handle(IPC.appGetRuntimePort, () => runtimePort);
ipcMain.handle(IPC.appGetUserDataDir, () => app.getPath("userData"));

async function readApiTokenWithRetry(): Promise<string | null> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const t = readApiTokenFromFile();
    if (t) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

ipcMain.handle(IPC.appGetApiToken, async () => readApiTokenWithRetry());

ipcMain.handle(IPC.appGetUserName, () => {
  try {
    const result = spawnSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      timeout: 2000,
    });
    const gitName = (result.stdout || "").trim();
    if (gitName) return { source: "git" as const, fullName: gitName, firstName: gitName.split(/\s+/)[0] };
  } catch {}
  const username = os.userInfo().username;
  return { source: "os" as const, fullName: username, firstName: username };
});

ipcMain.handle(IPC.cliCheck, (_evt, command: string) => {
  if (!command) return { ok: false, reason: "empty" };
  const resolved = resolveCommandOnPath(command, sanitizedProcessEnv());
  if (resolved) return { ok: true, path: resolved };
  return { ok: false, reason: "not-found" };
});

registerPtyHandlers(ipcMain, () => win, getProjectPath);
registerFileHandlers(ipcMain, () => win, getProjectPath);

ipcMain.handle(
  IPC.installSkillsFetchLatest,
  async (_evt, opts?: { licenseKey?: string }) => {
    try {
      const manifest = await fetchLatestSkillsManifest(opts?.licenseKey);
      return { ok: true as const, manifest };
    } catch (err) {
      logger.warn("installSkills.run failed", { err, op: "skills.install.ipc" });
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle(
  IPC.installSkillsRun,
  async (
    _evt,
    args: {
      projectPath: string;
      harnesses: { claude: boolean; codex: boolean };
      licenseKey?: string;
    },
  ) => {
    try {
      const result = await installSkills(args);
      return { ok: true as const, result };
    } catch (err) {
      logger.warn("installSkills.run failed", { err, op: "skills.install.ipc" });
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  isQuiting = true;
  killAllPtys();
  disposeAllFileWatchers();
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(() => {
  registerProjectImageProtocol();
  sendTelemetry("app_launch", app.getVersion());
  return createWindow();
}).catch((err) => {
  logger.error("app.startup failed", { err });
  app.quit();
});
