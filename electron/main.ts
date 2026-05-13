import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from "electron";
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
import { installSkills, fetchLatestSkillsManifest } from "./install-skills";
import { sendTelemetry } from "./telemetry";
import { augmentProcessEnv, resolveCommandOnPath, sanitizedProcessEnv } from "./shell-env";
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

ipcMain.handle(IPC.shellOpenPath, async (_evt, p: string) => {
  if (!p) return { ok: false, error: "empty" };
  const err = await shell.openPath(p);
  if (err) return { ok: false, error: err };
  return { ok: true };
});

ipcMain.handle(IPC.shellOpenExternal, async (_evt, url: string) => {
  return openExternalHttpUrl(url);
});

ipcMain.handle(IPC.appGetRuntimePort, () => runtimePort);
ipcMain.handle(IPC.appGetUserDataDir, () => app.getPath("userData"));

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

registerPtyHandlers(ipcMain, () => win);
registerFileHandlers(ipcMain, () => win);

ipcMain.handle(
  IPC.installSkillsFetchLatest,
  async (_evt, opts?: { baseUrl?: string; licenseKey?: string }) => {
    try {
      const manifest = await fetchLatestSkillsManifest(
        opts?.baseUrl,
        opts?.licenseKey,
      );
      return { ok: true as const, manifest };
    } catch (err) {
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
      baseUrl?: string;
      licenseKey?: string;
    },
  ) => {
    try {
      const result = await installSkills(args);
      return { ok: true as const, result };
    } catch (err) {
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
  (app as any).isQuiting = true;
  killAllPtys();
  disposeAllFileWatchers();
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(() => {
  registerProjectImageProtocol();
  sendTelemetry("app_launch", app.getVersion());
  return createWindow();
}).catch((err) => {
  console.error("[main] startup failed:", err);
  app.quit();
});
