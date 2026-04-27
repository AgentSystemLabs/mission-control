import { contextBridge, ipcRenderer, webUtils } from "electron";

const electronAPI = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  browseFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:browseFolder"),
  openPath: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("shell:openPath", path),
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
  onCloseIntent: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("app:close-intent", listener);
    return () => ipcRenderer.removeListener("app:close-intent", listener);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
