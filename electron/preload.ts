import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  browseFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:browseFolder"),
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
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
