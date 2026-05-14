import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "./ipc-channels";

const electronAPI = {
  hostKind: "desktop" as const,
  installSkills: {
    fetchLatest: (opts?: { licenseKey?: string }) =>
      ipcRenderer.invoke(IPC.installSkillsFetchLatest, opts),
    run: (args: {
      projectId: string;
      harnesses: { claude: boolean; codex: boolean };
      licenseKey?: string;
    }) => ipcRenderer.invoke(IPC.installSkillsRun, args),
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  browseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogBrowseFolder),
  pickProjectParentDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialogPickProjectParentDir),
  // Main scopes the relative path to the trusted project root.
  openPath: (
    projectId: string,
    relPath: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenPath, projectId, relPath),
  openExternal: (url: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenExternal, url),
  pickImage: (): Promise<
    { sourcePath: string; extension: string } | { error: string } | null
  > => ipcRenderer.invoke(IPC.dialogPickImage),
  saveProjectImage: (opts: {
    projectId: string;
    sourcePath: string;
    extension: string;
  }): Promise<{ filename: string } | { error: string }> =>
    ipcRenderer.invoke(IPC.fileSaveProjectImage, opts),
  getRuntimePort: (): Promise<number | null> => ipcRenderer.invoke(IPC.appGetRuntimePort),
  getApiBaseUrl: async (): Promise<string | null> => {
    const port = await ipcRenderer.invoke(IPC.appGetRuntimePort);
    return typeof port === "number" && port > 0 ? `http://127.0.0.1:${port}` : null;
  },
  getApiToken: (): Promise<string | null> => ipcRenderer.invoke(IPC.appGetApiToken),
  getUserDataDir: (): Promise<string> => ipcRenderer.invoke(IPC.appGetUserDataDir),
  getUserName: (): Promise<{ source: "git" | "os"; fullName: string; firstName: string }> =>
    ipcRenderer.invoke(IPC.appGetUserName),
  cliCheck: (command: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke(IPC.cliCheck, command),
  getProjectPath: (
    projectId: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.appGetProjectPath, projectId),
  pty: {
    spawn: (opts: {
      taskId: string;
      projectId: string;
      subPath?: string;
      command: string;
      args?: string[];
      cols?: number;
      rows?: number;
      agent?: string;
      mcEnv?: { apiUrl?: string; token?: string };
    }) => ipcRenderer.invoke(IPC.ptySpawn, opts) as Promise<{ ptyId: string }>,
    write: (ptyId: string, data: string, _projectId?: string) =>
      ipcRenderer.invoke(IPC.ptyWrite, { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.ptyResize, { ptyId, cols, rows }),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC.ptyKill, { ptyId }),
    killLaunchProcesses: (opts: { projectId: string; commands: string[]; ports?: number[] }) =>
      ipcRenderer.invoke(IPC.ptyKillLaunchProcesses, opts),
    onData: (cb: (msg: { ptyId: string; data: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { ptyId: string; data: string }) => cb(msg);
      ipcRenderer.on(IPC.ptyData, listener);
      return () => ipcRenderer.removeListener(IPC.ptyData, listener);
    },
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { ptyId: string; exitCode: number; signal?: number }) =>
        cb(msg);
      ipcRenderer.on(IPC.ptyExit, listener);
      return () => ipcRenderer.removeListener(IPC.ptyExit, listener);
    },
    replay: (ptyId: string): Promise<string> => ipcRenderer.invoke(IPC.ptyReplay, { ptyId }) as Promise<string>,
  },
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) => {
    const listener = (_: Electron.IpcRendererEvent, direction: "left" | "right" | "up" | "down") => cb(direction);
    ipcRenderer.on(IPC.appSwipe, listener);
    return () => ipcRenderer.removeListener(IPC.appSwipe, listener);
  },
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke(IPC.appIsFullScreen),
  onFullScreenChange: (cb: (isFullScreen: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, isFullScreen: boolean) => cb(isFullScreen);
    ipcRenderer.on(IPC.appFullScreenChange, listener);
    return () => ipcRenderer.removeListener(IPC.appFullScreenChange, listener);
  },
  onAgentHooksInstallFailed: (
    cb: (msg: {
      taskId: string;
      agent: string;
      reason: "unreadable" | "write-failed";
      file: string;
    }) => void,
  ) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      msg: { taskId: string; agent: string; reason: "unreadable" | "write-failed"; file: string },
    ) => cb(msg);
    ipcRenderer.on(IPC.agentHooksInstallFailed, listener);
    return () => ipcRenderer.removeListener(IPC.agentHooksInstallFailed, listener);
  },
  onCloseIntent: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.appCloseIntent, listener);
    return () => ipcRenderer.removeListener(IPC.appCloseIntent, listener);
  },
  files: {
    list: (projectId: string): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.filesList, projectId),
    read: (
      projectId: string,
      relPath: string,
    ): Promise<
      | { ok: true; content: string; mtimeMs: number; lineCount: number }
      | { ok: false; error: "invalid-path" | "not-found" | "binary" | "too-large" | "unknown-project" | string; lineCount?: number }
    > => ipcRenderer.invoke(IPC.filesRead, projectId, relPath),
    write: (
      projectId: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ): Promise<
      | { ok: true; mtimeMs: number }
      | { ok: false; error: "invalid-path" | "invalid-content" | "stale" | "unknown-project" | string; currentMtimeMs?: number }
    > => ipcRenderer.invoke(IPC.filesWrite, projectId, relPath, content, expectedMtimeMs),
    watch: (
      projectId: string,
      relPath: string,
    ): Promise<{ ok: true; watchId: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.filesWatch, projectId, relPath),
    unwatch: (watchId: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.filesUnwatch, watchId),
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { watchId: string; mtimeMs: number }) => cb(msg);
      ipcRenderer.on(IPC.filesChanged, listener);
      return () => ipcRenderer.removeListener(IPC.filesChanged, listener);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
