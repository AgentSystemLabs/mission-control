import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import { spawn, ChildProcess, spawnSync } from "node:child_process";
import { registerPtyHandlers, killAllPtys } from "./pty-manager";

const isDev = process.env.NODE_ENV === "development";
const devUrl = process.env.MC_DEV_URL || "http://127.0.0.1:5173";

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let runtimePort: number | null = null;

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(url);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

ipcMain.handle("dialog:browseFolder", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  (app as any).isQuiting = true;
  killAllPtys();
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(createWindow).catch((err) => {
  console.error("[main] startup failed:", err);
  app.quit();
});
