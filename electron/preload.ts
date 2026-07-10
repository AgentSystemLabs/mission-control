import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "./ipc-channels";

/** Subscribe to a main→renderer IPC channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

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

// Mirror of SandboxState in sandbox-manager.ts (structural — renderer never
// imports main-process code). Drift caught by reviewer-contracts.
export type SandboxStateBridge =
  | { status: "disabled" }
  | { status: "stopped"; dockerAvailable: boolean }
  | { status: "starting"; step: string; since?: number }
  | { status: "running"; since?: number }
  | { status: "connected"; version: string; agents: Record<string, string | null> }
  | {
      status: "update-required";
      version: string;
      expectedVersion: string;
      agents: Record<string, string | null>;
    }
  | { status: "error"; message: string };

export type SandboxSettingsBridge = {
  enabled: boolean;
  runtimeMode: "host" | "docker";
  dockerfilePath: string | null;
  buildArgKeys: string[];
  hasBuildArgs: boolean;
  imageTag: string | null;
  publishedPorts: number[];
  workspaceVolume: string;
  projectPaths: Record<string, string>;
  agentPort: number;
  gitAuthMode: "none" | "copy-host" | "generate";
  /** The pairing token itself is never sent to the renderer. */
  hasPairingToken: boolean;
};

export type SandboxSettingsPatchBridge = Partial<{
  enabled: boolean;
  runtimeMode: "host" | "docker";
  dockerfilePath: string | null;
  buildArgs: Record<string, string>;
  imageTag: string | null;
  publishedPorts: string | number[];
  workspaceVolume: string;
  projectPaths: Record<string, string>;
  agentPort: number;
  gitAuthMode: "none" | "copy-host" | "generate";
}>;

export type RemotePtySpawnOptionsBridge = {
  taskId: string;
  /** Absolute in-container path (e.g. /workspace/<slug>). */
  cwd: string;
  command: string;
  agent?: string;
  shell?: boolean;
  args?: string[];
  cols?: number;
  rows?: number;
  dangerouslySkipPermissions?: boolean;
  missionControlTheme?: "dark" | "light";
};

export type RemoteVmDeployInputBridge = {
  provider: "aws";
  sandboxId?: string;
  name: string;
  region: string;
  size?: string;
  keyName?: string;
  identityFile?: string;
  accessCidr?: string;
  sshCidr?: string;
  localPort?: number;
  profile?: string;
  imageId?: string;
  subnetId?: string;
  securityGroupId?: string;
  noWait?: boolean;
  activate?: boolean;
  setupScript?: string;
  gitAuthMode?: "none" | "copy-host" | "generate";
  copyAgentCreds?: boolean;
  idleTimeoutMinutes?: number;
  imageStrategy?: "golden" | "full-install";
  projectId?: string;
};

export type RemoteVmDeployResultBridge =
  | {
      ok: true;
      sandboxId: string;
      name: string;
      provider: string;
      publicIp: string;
      agentUrl: string;
      localPort: number | null;
      output: string;
    }
  | { ok: false; error: string; output?: string };

export type RemoteVmDeployJobStatusBridge = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type RemoteVmDeployJobResultBridge = {
  sandboxId: string;
  name: string;
  provider: string;
  publicIp: string;
  agentUrl: string;
  localPort: number | null;
};

export type RemoteVmDeployLogEntryBridge = {
  jobId: string;
  seq: number;
  ts: number;
  stream: "stdout" | "stderr" | "system";
  data: string;
};

export type RemoteVmDeployJobSnapshotBridge = {
  id: string;
  input: RemoteVmDeployInputBridge;
  status: RemoteVmDeployJobStatusBridge;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
  nextSeq: number;
  result?: RemoteVmDeployJobResultBridge;
  error?: string;
  exitCode?: number | null;
  signal?: string | null;
};

const electronAPI = {
  /** The host OS, straight from the main process (authoritative, unlike navigator.platform). */
  platform: process.platform,
  settings: {
    getToken: (): Promise<string> => ipcRenderer.invoke(IPC.settingsGetToken),
    regenerateToken: (): Promise<string> =>
      ipcRenderer.invoke(IPC.settingsRegenerateToken),
  },
  voice: {
    /** Whether the bundled whisper model is installed on this platform. */
    available: (): Promise<boolean> => ipcRenderer.invoke(IPC.voiceAvailable),
    /** Load the model ahead of the first command so push-to-talk feels instant. */
    prewarm: (): Promise<boolean> => ipcRenderer.invoke(IPC.voicePrewarm),
    /** Transcribe a 16 kHz mono 16-bit WAV buffer offline via whisper.cpp.
     *  `prompt` biases the decoder toward expected words (e.g. project names). */
    transcribe: (
      wav: ArrayBuffer,
      prompt?: string,
    ): Promise<
      { ok: true; text: string } | { ok: false; error: string; code?: "unavailable" }
    > => ipcRenderer.invoke(IPC.voiceTranscribe, wav, prompt),
  },
  sandbox: {
    // Phase 2: lifecycle is per-sandbox (sandboxId; falls back to the active scope).
    getState: (sandboxId?: string): Promise<SandboxStateBridge> =>
      ipcRenderer.invoke(IPC.sandboxGetState, sandboxId),
    getSettings: (): Promise<SandboxSettingsBridge> => ipcRenderer.invoke(IPC.sandboxGetSettings),
    updateSettings: (patch: SandboxSettingsPatchBridge): Promise<SandboxSettingsBridge> =>
      ipcRenderer.invoke(IPC.sandboxUpdateSettings, patch),
    up: (sandboxId?: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxUp, sandboxId),
    rebuild: (sandboxId?: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxRebuild, sandboxId),
    down: (sandboxId?: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxDown, sandboxId),
    destroy: (sandboxId: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxDestroy, sandboxId),
    /** Set the scope the renderer is showing; routes remote PTY/fs/git. null = Local. */
    setActive: (sandboxId: string | null): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.sandboxSetActive, sandboxId),
    connect: (sandboxId?: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxConnect, sandboxId),
    disconnect: (sandboxId?: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.sandboxDisconnect, sandboxId),
    status: (): Promise<{
      dockerAvailable: boolean;
      states: Array<{ sandboxId: string; state: SandboxStateBridge }>;
    }> => ipcRenderer.invoke(IPC.sandboxStatus),
    validateDockerfile: (
      p: string,
    ): Promise<{ ok: true; exists: boolean; isDirectory: boolean }> =>
      ipcRenderer.invoke(IPC.sandboxValidateDockerfile, p),
    diagnostics: (): Promise<string> => ipcRenderer.invoke(IPC.sandboxDiagnostics),
    setupGitAuth: (sandboxId?: string): Promise<{ publicKey?: string }> =>
      ipcRenderer.invoke(IPC.sandboxSetupGitAuth, sandboxId),
    upgradeAgent: (
      sandboxId?: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxUpgradeAgent, sandboxId),
    revealApiKey: (
      sandboxId: string,
    ): Promise<{ ok: true; apiKey: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.sandboxRevealApiKey, sandboxId),
    detectRemote: (projectPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.sandboxDetectRemote, projectPath),
    onStateChange: (cb: (e: { sandboxId: string; state: SandboxStateBridge }) => void) =>
      subscribe(IPC.sandboxStateChange, cb),
    onLog: (cb: (line: string) => void) => subscribe(IPC.sandboxLog, cb),
  },
  remoteVm: {
    deploy: (input: RemoteVmDeployInputBridge): Promise<RemoteVmDeployResultBridge> =>
      ipcRenderer.invoke(IPC.remoteVmDeploy, input),
    startDeploy: (input: RemoteVmDeployInputBridge): Promise<{ jobId: string }> =>
      ipcRenderer.invoke(IPC.remoteVmStartDeploy, input),
    listDeployJobs: (): Promise<RemoteVmDeployJobSnapshotBridge[]> =>
      ipcRenderer.invoke(IPC.remoteVmListDeployJobs),
    getDeployLogs: (
      jobId: string,
      afterSeq?: number,
    ): Promise<{ entries: RemoteVmDeployLogEntryBridge[]; nextSeq: number }> =>
      ipcRenderer.invoke(IPC.remoteVmGetDeployLogs, jobId, afterSeq),
    cancelDeploy: (jobId: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.remoteVmCancelDeploy, jobId),
    pause: (sandboxId: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.remoteVmPause, sandboxId),
    resume: (sandboxId: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.remoteVmResume, sandboxId),
    reconcile: (
      sandboxId: string,
    ): Promise<
      | { ok: true; sandboxId: string; instanceState: string | null; status: string | null; changed: boolean }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.remoteVmReconcile, sandboxId),
    destroy: (
      sandboxId: string,
      opts?: { keepRow?: boolean },
    ): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.remoteVmDestroy, sandboxId, opts),
    onDeployUpdate: (cb: (job: RemoteVmDeployJobSnapshotBridge) => void) =>
      subscribe(IPC.remoteVmDeployUpdate, cb),
    onDeployLog: (cb: (entry: RemoteVmDeployLogEntryBridge) => void) =>
      subscribe(IPC.remoteVmDeployLog, cb),
  },
  remotePty: {
    spawn: (opts: RemotePtySpawnOptionsBridge): Promise<{ ptyId: string }> =>
      ipcRenderer.invoke(IPC.remotePtySpawn, opts),
    write: (ptyId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.remotePtyWrite, ptyId, data),
    resize: (ptyId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.remotePtyResize, ptyId, cols, rows),
    kill: (ptyId: string): Promise<boolean> => ipcRenderer.invoke(IPC.remotePtyKill, ptyId),
    replay: (ptyId: string): Promise<{ data: string; nextSeq: number }> =>
      ipcRenderer.invoke(IPC.remotePtyReplay, ptyId),
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) =>
      subscribe(IPC.remotePtyData, cb),
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) =>
      subscribe(IPC.remotePtyExit, cb),
    onSpawned: (cb: (msg: { ptyId: string }) => void) => subscribe(IPC.remotePtySpawned, cb),
    onSpawnError: (cb: (msg: { ptyId: string; code: string; message: string }) => void) =>
      subscribe(IPC.remotePtySpawnError, cb),
  },
  remoteFs: {
    list: (path: string) => ipcRenderer.invoke(IPC.remoteFsList, path),
    read: (path: string) => ipcRenderer.invoke(IPC.remoteFsRead, path),
    write: (path: string, content: string, expectedMtimeMs: number | null) =>
      ipcRenderer.invoke(IPC.remoteFsWrite, path, content, expectedMtimeMs),
    watch: (path: string) => ipcRenderer.invoke(IPC.remoteFsWatch, path),
    unwatch: (watchId: string) => ipcRenderer.invoke(IPC.remoteFsUnwatch, watchId),
    onChange: (cb: (msg: { watchId: string; path: string; mtimeMs: number }) => void) =>
      subscribe(IPC.remoteFsChange, cb),
  },
  remoteGit: {
    status: (repo: string) => ipcRenderer.invoke(IPC.remoteGitStatus, repo),
    diff: (repo: string, file: string, staged: boolean) =>
      ipcRenderer.invoke(IPC.remoteGitDiff, repo, file, staged),
    clone: (remote: string, slug: string, branch?: string) =>
      ipcRenderer.invoke(IPC.remoteGitClone, remote, slug, branch),
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
  terminalImages: {
    saveDropped: (input: {
      name?: string;
      mimeType: string;
      data: ArrayBuffer;
    }): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke(IPC.terminalSaveDroppedImage, input),
    saveClipboard: (): Promise<{ path: string } | { error: string } | null> =>
      ipcRenderer.invoke(IPC.terminalSaveClipboardImage),
    copyToClipboard: (path: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke(IPC.terminalCopyImageToClipboard, path),
    delete: (path: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke(IPC.terminalDeleteImage, path),
  },
  screenshot: {
    captureRegion: (): Promise<
      | { path: string; previewDataUrl: string }
      | { cancelled: true }
      | { error: string }
    > => ipcRenderer.invoke(IPC.screenshotCaptureRegion),
    readImage: (
      path: string,
    ): Promise<{ dataUrl: string } | { error: string }> =>
      ipcRenderer.invoke(IPC.screenshotReadImage, path),
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
  setWindowBackgroundColor: (color: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.appSetBackgroundColor, color),
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
    ) => subscribe(IPC.notificationsSessionFinishedClick, cb),
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
  cliRunUpdate: (agent: string): Promise<
    | { ok: true; agent: string; command: string; version: string | null }
    | {
        ok: false;
        agent: string;
        command?: string;
        reason: string;
        exitCode?: number | null;
        output?: string;
      }
  > =>
    ipcRenderer.invoke(IPC.cliRunUpdate, agent),
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
    killUnderPath: (cwd: string) =>
      ipcRenderer.invoke(IPC.ptyKillUnderPath, { cwd }) as Promise<{ ptyCount: number }>,
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) =>
      subscribe(IPC.ptyData, cb),
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) =>
      subscribe(IPC.ptyExit, cb),
    replay: (ptyId: string): Promise<{ data: string; nextSeq: number }> =>
      ipcRenderer.invoke(IPC.ptyReplay, { ptyId }) as Promise<{ data: string; nextSeq: number }>,
    findByTask: (taskId: string): Promise<{ ptyId: string | null }> =>
      ipcRenderer.invoke(IPC.ptyFindByTask, { taskId }) as Promise<{ ptyId: string | null }>,
  },
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) =>
    subscribe(IPC.appSwipe, cb),
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke(IPC.appIsFullScreen),
  onFullScreenChange: (cb: (isFullScreen: boolean) => void) =>
    subscribe(IPC.appFullScreenChange, cb),
  onCloseIntent: (cb: () => void) => subscribe(IPC.appCloseIntent, cb),
  focusMode: {
    enter: (taskId: string): Promise<{ active: boolean; taskId: string | null; alwaysOnTop: boolean }> =>
      ipcRenderer.invoke(IPC.appEnterFocusMode, { taskId }),
    exit: (): Promise<{ active: boolean; taskId: string | null; alwaysOnTop: boolean }> =>
      ipcRenderer.invoke(IPC.appExitFocusMode),
    get: (): Promise<{ active: boolean; taskId: string | null; alwaysOnTop: boolean }> =>
      ipcRenderer.invoke(IPC.appGetFocusMode),
    setAlwaysOnTop: (
      enabled: boolean,
    ): Promise<{ active: boolean; taskId: string | null; alwaysOnTop: boolean }> =>
      ipcRenderer.invoke(IPC.appSetFocusModeAlwaysOnTop, { enabled }),
  },
  updater: {
    getState: (): Promise<UpdateStateBridge> =>
      ipcRenderer.invoke(IPC.updateGetState) as Promise<UpdateStateBridge>,
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updateCheck) as Promise<void>,
    download: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.updateDownload),
    installNow: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.updateInstall),
    onStateChange: (cb: (state: UpdateStateBridge) => void) =>
      subscribe(IPC.updateStateChange, cb),
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
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) =>
      subscribe(IPC.filesChanged, cb),
  },
  preview: {
    startServer: (
      projectRoot: string,
    ): Promise<{ ok: true; port: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.previewStartServer, projectRoot),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
