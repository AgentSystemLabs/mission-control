import { contextBridge, ipcRenderer, webUtils } from "electron";

const electronAPI = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  browseFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:browseFolder"),
  openPath: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("shell:openPath", path),
  openExternal: (url: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("shell:openExternal", url),
  pickImage: (): Promise<
    { sourcePath: string; extension: string } | { error: string } | null
  > => ipcRenderer.invoke("dialog:pickImage"),
  saveProjectImage: (opts: {
    projectId: string;
    sourcePath: string;
    extension: string;
  }): Promise<{ filename: string } | { error: string }> =>
    ipcRenderer.invoke("file:saveProjectImage", opts),
  getRuntimePort: (): Promise<number | null> => ipcRenderer.invoke("app:getRuntimePort"),
  getUserDataDir: (): Promise<string> => ipcRenderer.invoke("app:getUserDataDir"),
  getUserName: (): Promise<{ source: "git" | "os"; fullName: string; firstName: string }> =>
    ipcRenderer.invoke("app:getUserName"),
  cliCheck: (command: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke("cli:check", command),
  pty: {
    spawn: (opts: {
      taskId: string;
      cwd: string;
      command: string;
      args?: string[];
      cols?: number;
      rows?: number;
      agent?: string;
      mcEnv?: { apiUrl?: string; token?: string };
    }) => ipcRenderer.invoke("pty:spawn", opts) as Promise<{ ptyId: string }>,
    write: (ptyId: string, data: string) => ipcRenderer.invoke("pty:write", { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke("pty:resize", { ptyId, cols, rows }),
    kill: (ptyId: string) => ipcRenderer.invoke("pty:kill", { ptyId }),
    onData: (cb: (msg: { ptyId: string; data: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { ptyId: string; data: string }) => cb(msg);
      ipcRenderer.on("pty:data", listener);
      return () => ipcRenderer.removeListener("pty:data", listener);
    },
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { ptyId: string; exitCode: number; signal?: number }) =>
        cb(msg);
      ipcRenderer.on("pty:exit", listener);
      return () => ipcRenderer.removeListener("pty:exit", listener);
    },
    replay: (ptyId: string): Promise<string> => ipcRenderer.invoke("pty:replay", { ptyId }) as Promise<string>,
  },
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) => {
    const listener = (_: Electron.IpcRendererEvent, direction: "left" | "right" | "up" | "down") => cb(direction);
    ipcRenderer.on("app:swipe", listener);
    return () => ipcRenderer.removeListener("app:swipe", listener);
  },
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("app:isFullScreen"),
  onFullScreenChange: (cb: (isFullScreen: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, isFullScreen: boolean) => cb(isFullScreen);
    ipcRenderer.on("app:fullscreen-change", listener);
    return () => ipcRenderer.removeListener("app:fullscreen-change", listener);
  },
  onCloseIntent: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("app:close-intent", listener);
    return () => ipcRenderer.removeListener("app:close-intent", listener);
  },
  files: {
    list: (projectRoot: string): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> =>
      ipcRenderer.invoke("files:list", projectRoot),
    read: (
      projectRoot: string,
      relPath: string,
    ): Promise<
      | { ok: true; content: string; mtimeMs: number; lineCount: number }
      | { ok: false; error: "invalid-path" | "not-found" | "binary" | "too-large" | string; lineCount?: number }
    > => ipcRenderer.invoke("files:read", projectRoot, relPath),
    write: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ): Promise<
      | { ok: true; mtimeMs: number }
      | { ok: false; error: "invalid-path" | "invalid-content" | "stale" | string; currentMtimeMs?: number }
    > => ipcRenderer.invoke("files:write", projectRoot, relPath, content, expectedMtimeMs),
    watch: (
      projectRoot: string,
      relPath: string,
    ): Promise<{ ok: true; watchId: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("files:watch", projectRoot, relPath),
    unwatch: (watchId: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke("files:unwatch", watchId),
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { watchId: string; mtimeMs: number }) => cb(msg);
      ipcRenderer.on("files:changed", listener);
      return () => ipcRenderer.removeListener("files:changed", listener);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
