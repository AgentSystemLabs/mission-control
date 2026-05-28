import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "./ipc-channels";

// Mirror of UpdateState in update-manager.ts. Kept structural here so the renderer
// bundle never imports main-process code. Drift between the two is caught by the
// reviewer-contracts subagent.
export type UpdateStateBridge =
  | { kind: "unsupported-dev" }
  | { kind: "idle"; lastCheckedAt: number | null }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | {
      kind: "downloading";
      version: string;
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { kind: "ready-to-install"; version: string }
  | { kind: "error"; message: string };

export type SessionTerminalDebugLogInputBridge = {
  level?: "error" | "warn";
  stage: string;
  message: string;
  source?: "pty-manager" | "renderer";
  taskId?: string;
  ptyId?: string;
  agent?: string;
  cwd?: string;
  command?: string;
  exitCode?: number;
  signal?: number | string;
  elapsedMs?: number;
  details?: Record<string, unknown>;
  outputTail?: string;
};

export type SessionTerminalDebugLogEntryBridge = SessionTerminalDebugLogInputBridge & {
  id: string;
  level: "error" | "warn";
  source: "pty-manager" | "renderer";
  createdAt: string;
  platform: NodeJS.Platform;
  arch: string;
};

const electronAPI = {
  settings: {
    getToken: (): Promise<string> => ipcRenderer.invoke(IPC.settingsGetToken),
    regenerateToken: (): Promise<string> =>
      ipcRenderer.invoke(IPC.settingsRegenerateToken),
  },
  debugLog: {
    listSessionTerminalErrors: (): Promise<SessionTerminalDebugLogEntryBridge[]> =>
      ipcRenderer.invoke(IPC.debugSessionTerminalLogsList),
    clearSessionTerminalErrors: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.debugSessionTerminalLogsClear),
    recordSessionTerminalError: (
      input: SessionTerminalDebugLogInputBridge,
    ): Promise<SessionTerminalDebugLogEntryBridge> =>
      ipcRenderer.invoke(IPC.debugSessionTerminalLogsRecord, input),
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  browseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogBrowseFolder),
  openPath: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenPath, path),
  openExternal: (url: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenExternal, url),
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke(IPC.clipboardReadText),
    writeText: (text: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.clipboardWriteText, text),
  },
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
  getUserDataDir: (): Promise<string> => ipcRenderer.invoke(IPC.appGetUserDataDir),
  getUserName: (): Promise<{ source: "git" | "os"; fullName: string; firstName: string }> =>
    ipcRenderer.invoke(IPC.appGetUserName),
  reload: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.appReload),
  notifications: {
    getPermission: (): Promise<"granted" | "unsupported"> =>
      ipcRenderer.invoke(IPC.notificationsGetPermission),
    showSessionFinished: (payload: {
      tag: string;
      title: string;
      body: string;
      projectId: string;
      taskId: string;
      worktreeId: string | null;
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.notificationsShowSessionFinished, payload),
    onSessionFinishedClick: (
      cb: (payload: {
        projectId: string;
        taskId: string;
        worktreeId: string | null;
      }) => void,
    ) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { projectId: string; taskId: string; worktreeId: string | null },
      ) => cb(payload);
      ipcRenderer.on(IPC.notificationsSessionFinishedClick, listener);
      return () => ipcRenderer.removeListener(IPC.notificationsSessionFinishedClick, listener);
    },
  },
  cliCheck: (command: string, opts?: { verifyVersion?: boolean }): Promise<
    | {
        ok: true;
        path: string;
        version?: string;
        label?: string;
        requiredVersion?: string;
        packageUrl?: string;
        updateCommands?: readonly string[];
      }
    | {
        ok: false;
        reason: string;
        path?: string;
        label?: string;
        version?: string;
        requiredVersion?: string;
        packageUrl?: string;
        updateCommands?: readonly string[];
      }
  > =>
    ipcRenderer.invoke(IPC.cliCheck, command, opts),
  pty: {
    spawn: (opts: {
      taskId: string;
      cwd: string;
      command: string;
      args?: string[];
      cols?: number;
      rows?: number;
      agent?: string;
      dangerouslySkipPermissions?: boolean;
      mcEnv?: { apiUrl?: string; token?: string };
      missionControlTheme?: "dark" | "light";
      // Required when `agent` is omitted: signals an intentional user-shell
      // terminal that runs `command` through the login shell. Agent terminals
      // (claude-code/codex/cursor-cli/opencode) must leave this unset and pass `command`
      // starting with the agent's binary name, which spawns directly via argv.
      shell?: boolean;
    }) => ipcRenderer.invoke(IPC.ptySpawn, opts) as Promise<{ ptyId: string }>,
    write: (ptyId: string, data: string) => ipcRenderer.invoke(IPC.ptyWrite, { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.ptyResize, { ptyId, cols, rows }),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC.ptyKill, { ptyId }),
    killLaunchProcesses: (opts: { cwd: string; commands: string[]; ports?: number[] }) =>
      ipcRenderer.invoke(IPC.ptyKillLaunchProcesses, opts),
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        msg: { ptyId: string; data: string; seq: number },
      ) => cb(msg);
      ipcRenderer.on(IPC.ptyData, listener);
      return () => ipcRenderer.removeListener(IPC.ptyData, listener);
    },
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, msg: { ptyId: string; exitCode: number; signal?: number }) =>
        cb(msg);
      ipcRenderer.on(IPC.ptyExit, listener);
      return () => ipcRenderer.removeListener(IPC.ptyExit, listener);
    },
    replay: (ptyId: string): Promise<{ data: string; nextSeq: number }> =>
      ipcRenderer.invoke(IPC.ptyReplay, { ptyId }) as Promise<{ data: string; nextSeq: number }>,
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
  onCloseIntent: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.appCloseIntent, listener);
    return () => ipcRenderer.removeListener(IPC.appCloseIntent, listener);
  },
  updater: {
    getState: (): Promise<UpdateStateBridge> =>
      ipcRenderer.invoke(IPC.updateGetState) as Promise<UpdateStateBridge>,
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updateCheck) as Promise<void>,
    download: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.updateDownload),
    installNow: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.updateInstall),
    onStateChange: (cb: (state: UpdateStateBridge) => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: UpdateStateBridge) => cb(state);
      ipcRenderer.on(IPC.updateStateChange, listener);
      return () => ipcRenderer.removeListener(IPC.updateStateChange, listener);
    },
  },
  files: {
    list: (projectRoot: string): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.filesList, projectRoot),
    read: (
      projectRoot: string,
      relPath: string,
    ): Promise<
      | { ok: true; kind: "text"; content: string; mtimeMs: number; lineCount: number }
      | {
          ok: true;
          kind: "image";
          dataUrl: string;
          mimeType:
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/x-icon"
            | "image/avif";
          size: number;
          mtimeMs: number;
        }
      | { ok: false; error: "invalid-path" | "not-found" | "binary" | "too-large" | string; lineCount?: number }
    > => ipcRenderer.invoke(IPC.filesRead, projectRoot, relPath),
    write: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ): Promise<
      | { ok: true; mtimeMs: number }
      | {
          ok: false;
          error:
            | "invalid-path"
            | "invalid-content"
            | "stale"
            | "protected-path"
            | string;
          currentMtimeMs?: number;
        }
    > => ipcRenderer.invoke(IPC.filesWrite, projectRoot, relPath, content, expectedMtimeMs),
    writeSensitive: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ): Promise<
      | { ok: true; mtimeMs: number }
      | {
          ok: false;
          error:
            | "invalid-path"
            | "invalid-content"
            | "stale"
            | "user-declined"
            | string;
          currentMtimeMs?: number;
        }
    > => ipcRenderer.invoke(IPC.filesWriteSensitive, projectRoot, relPath, content, expectedMtimeMs),
    watch: (
      projectRoot: string,
      relPath: string,
    ): Promise<{ ok: true; watchId: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.filesWatch, projectRoot, relPath),
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
