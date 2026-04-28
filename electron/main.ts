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

const isDev = process.env.NODE_ENV === "development";
const devUrl = process.env.MC_DEV_URL || "http://127.0.0.1:5173";

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let runtimePort: number | null = null;

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
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

async function startProductionServer(): Promise<string> {
  const port = await pickPort();
  runtimePort = port;
  const portFile = path.join(app.getPath("userData"), ".port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(port), "utf8");

  const serverEntry = path.join(process.resourcesPath, "app", ".output", "server", "index.mjs");
  const fallbackEntry = path.join(__dirname, "..", ".output", "server", "index.mjs");
  const entry = fs.existsSync(serverEntry) ? serverEntry : fallbackEntry;

  serverProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
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

  await waitForHttp(`http://127.0.0.1:${port}`);
  return `http://127.0.0.1:${port}`;
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
    backgroundColor: "#0a0b0d",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
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
      win?.webContents.send("app:close-intent");
    }
  });

  // macOS-only: 3-finger swipe (System Settings → Trackpad → More Gestures).
  win.on("swipe", (_e, direction) => {
    win?.webContents.send("app:swipe", direction);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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

ipcMain.handle("dialog:pickImage", async () => {
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
  "file:saveProjectImage",
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
    if (stat.size > MAX_IMAGE_BYTES) return { error: "image exceeds 5MB" };

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

ipcMain.handle("dialog:browseFolder", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:openPath", async (_evt, p: string) => {
  if (!p) return { ok: false, error: "empty" };
  const err = await shell.openPath(p);
  if (err) return { ok: false, error: err };
  return { ok: true };
});

ipcMain.handle("app:getRuntimePort", () => runtimePort);
ipcMain.handle("app:getUserDataDir", () => app.getPath("userData"));

ipcMain.handle("cli:check", (_evt, command: string) => {
  if (!command) return { ok: false, reason: "empty" };
  const isWindows = os.platform() === "win32";
  const probe = isWindows ? "where" : "command";
  const args = isWindows ? [command] : ["-v", command];
  // Run inside the user's shell so PATH and shell-defined aliases resolve.
  const userShell = process.env.SHELL || "/bin/bash";
  const cmdline = isWindows ? `${probe} ${command}` : `${probe} ${args.join(" ")}`;
  const result = spawnSync(userShell, ["-l", "-c", cmdline], {
    encoding: "utf8",
    timeout: 4000,
  });
  if (result.status === 0 && (result.stdout || "").trim()) {
    return { ok: true, path: (result.stdout || "").trim().split(/\r?\n/)[0] };
  }
  return { ok: false, reason: "not-found" };
});

registerPtyHandlers(ipcMain, () => win);
registerFileHandlers(ipcMain, () => win);

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
  return createWindow();
}).catch((err) => {
  console.error("[main] startup failed:", err);
  app.quit();
});
