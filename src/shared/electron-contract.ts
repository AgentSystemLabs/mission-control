import type { GitStatus, GitDiff } from "~/shared/git-status";

export const FILE_READ_ERRORS = ["invalid-path", "not-found", "binary", "too-large"] as const;
export const FILE_WRITE_ERRORS = [
  "invalid-path",
  "invalid-content",
  "stale",
  // Hit when the renderer tried the generic `files:write` for an auto-executing
  // config path (Claude/Codex hooks, .git/hooks, package.json, etc). The
  // renderer is expected to retry via `files:writeSensitive`, which surfaces a
  // native confirm in the main process.
  "protected-path",
  // Returned by `files:writeSensitive` when the user clicked Cancel in the
  // native confirm dialog. Not an error condition — just a no-op result.
  "user-declined",
] as const;

export type FileReadError = (typeof FILE_READ_ERRORS)[number];
export type FileWriteError = (typeof FILE_WRITE_ERRORS)[number];

export type FileListResult = { ok: true; files: string[] } | { ok: false; error: string };

export type ImagePreviewMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/bmp"
  | "image/x-icon"
  | "image/avif";

export type FileReadResult =
  | { ok: true; kind: "text"; content: string; mtimeMs: number; lineCount: number }
  | {
      ok: true;
      kind: "image";
      dataUrl: string;
      mimeType: ImagePreviewMime;
      size: number;
      mtimeMs: number;
    }
  | { ok: false; error: FileReadError | string; lineCount?: number };

export type FileWriteResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; error: FileWriteError | string; currentMtimeMs?: number };

export type InstallDiagramSkillResult = import("~/shared/diagram-skill-install").DiagramSkillInstallResult;
export type InstallShipSkillsResult = import("~/shared/ship-skill-install").ShipSkillInstallResult;

export type LaunchProcessKillResult = {
  ptyCount: number;
  ports: Array<{
    port: number;
    pids: number[];
    killed: number[];
    errors: string[];
  }>;
};

export type PtySpawnAgent = "claude-code" | "codex" | "cursor-cli" | "opencode";

export type CliCheckResult =
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
    };

export type BasePtySpawnOptions = {
  taskId: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  mcEnv?: { apiUrl?: string; token?: string };
  missionControlTheme?: "dark" | "light";
};

export type AgentPtySpawnOptions = BasePtySpawnOptions & {
  agent: PtySpawnAgent;
  dangerouslySkipPermissions?: boolean;
  shell?: never;
  /** Starting prompt written to the agent's stdin once its TUI is ready (voice control). */
  initialInput?: string;
};

export type ShellPtySpawnOptions = BasePtySpawnOptions & {
  shell: true;
  agent?: never;
  dangerouslySkipPermissions?: never;
  /**
   * Project-less "home" terminal (dashboard). The main process replaces cwd with
   * its own os.homedir() and whitelists it; the renderer may pass cwd: "".
   */
  home?: boolean;
};

export type PtySpawnOptions = AgentPtySpawnOptions | ShellPtySpawnOptions;

export type RemotePtySpawnOptions = {
  taskId: string;
  /** Absolute in-container path (e.g. /workspace/<slug>). */
  cwd: string;
  command: string;
  agent?: string;
  shell?: boolean;
  /** Project-less "home" shell terminal: open at the remote agent's home dir. */
  home?: boolean;
  args?: string[];
  cols?: number;
  rows?: number;
  dangerouslySkipPermissions?: boolean;
  missionControlTheme?: "dark" | "light";
};

export type SandboxRuntimeMode = "host" | "docker";
export type SandboxGitAuthMode = "none" | "copy-host" | "generate";
// Mirror of SandboxImageStrategy in ~/shared/sandbox. Drift caught by reviewer-contracts.
export type SandboxImageStrategy = "golden" | "full-install";

// Mirror of SandboxState in electron/sandbox-manager.ts. Drift caught by reviewer-contracts.
export type SandboxState =
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

export type SandboxSettingsView = {
  enabled: boolean;
  runtimeMode: SandboxRuntimeMode;
  dockerfilePath: string | null;
  buildArgKeys: string[];
  hasBuildArgs: boolean;
  imageTag: string | null;
  publishedPorts: number[];
  workspaceVolume: string;
  projectPaths: Record<string, string>;
  agentPort: number;
  gitAuthMode: SandboxGitAuthMode;
  /** The pairing token itself is never sent to the renderer. */
  hasPairingToken: boolean;
};

export type SandboxSettingsPatch = Partial<{
  enabled: boolean;
  runtimeMode: SandboxRuntimeMode;
  dockerfilePath: string | null;
  buildArgs: Record<string, string>;
  imageTag: string | null;
  publishedPorts: string | number[];
  workspaceVolume: string;
  projectPaths: Record<string, string>;
  agentPort: number;
  gitAuthMode: SandboxGitAuthMode;
}>;

export type RemoteVmDeployInput = {
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
  /** Optional bootstrap script run on the VM after the agent is healthy (user_data.sh style). */
  setupScript?: string;
  /** When "copy-host", the user's ~/.ssh keys are pushed to the VM over the agent WS on connect. */
  gitAuthMode?: SandboxGitAuthMode;
  /** When true, the host's AI-CLI logins are pushed to the VM over the agent WS on connect. */
  copyAgentCreds?: boolean;
  /** Stop the EC2 instance after this many minutes with no agent activity. 0 disables. Default 30. */
  idleTimeoutMinutes?: number;
  /** Launch from the maintained golden AMI (default) or run the full setup script. */
  imageStrategy?: SandboxImageStrategy;
  /** Owning project when created from the project sandbox flow. */
  projectId?: string;
};

export type RemoteVmDeployResult =
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

/**
 * Result of reconciling a managed remote VM's saved status against the cloud
 * provider's real instance state. `status` is the (possibly updated) lifecycle
 * status persisted on the sandbox; `instanceState` is the raw provider state.
 */
export type RemoteVmReconcileResult =
  | {
      ok: true;
      sandboxId: string;
      instanceState: string | null;
      status: string | null;
      /** True when this call transitioned the saved status (e.g. ready → paused). */
      changed: boolean;
    }
  | { ok: false; error: string };

export type RemoteVmDeployJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type RemoteVmDeployJobResult = {
  sandboxId: string;
  name: string;
  provider: string;
  publicIp: string;
  agentUrl: string;
  localPort: number | null;
};

export type RemoteVmDeployLogEntry = {
  jobId: string;
  seq: number;
  ts: number;
  stream: "stdout" | "stderr" | "system";
  data: string;
};

export type RemoteVmDeployJobSnapshot = {
  id: string;
  input: RemoteVmDeployInput;
  status: RemoteVmDeployJobStatus;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
  nextSeq: number;
  result?: RemoteVmDeployJobResult;
  error?: string;
  exitCode?: number | null;
  signal?: string | null;
};

export type TerminalImageSaveInput = {
  name?: string;
  mimeType: string;
  data: ArrayBuffer;
};

export type TerminalImageSaveResult = { path: string } | { error: string };

export type ScreenshotCaptureResult =
  | { path: string; previewDataUrl: string }
  | { cancelled: true }
  | { error: string };

export type VoiceTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; code?: "unavailable" };

export type FocusModeStateBridge = {
  active: boolean;
  taskId: string | null;
  alwaysOnTop: boolean;
};

export type ElectronBridge = {
  /** The host OS, straight from the main process (authoritative, unlike navigator.platform). */
  platform: NodeJS.Platform;
  settings: {
    getToken: () => Promise<string>;
    regenerateToken: () => Promise<string>;
  };
  voice: {
    available: () => Promise<boolean>;
    prewarm: () => Promise<boolean>;
    /** `prompt` biases the decoder toward expected words (e.g. project names). */
    transcribe: (wav: ArrayBuffer, prompt?: string) => Promise<VoiceTranscribeResult>;
  };
  getPathForFile: (file: File) => string;
  browseFolder: () => Promise<string | null>;
  openPath: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<{ ok: true }>;
  };
  terminalImages: {
    saveDropped: (input: TerminalImageSaveInput) => Promise<TerminalImageSaveResult>;
    saveClipboard: () => Promise<TerminalImageSaveResult | null>;
    /** Put a saved terminal image on the OS clipboard for a Ctrl+V image paste. */
    copyToClipboard: (path: string) => Promise<{ ok: true } | { error: string }>;
    /** Hard-delete a saved terminal image from disk (used by screenshot history). */
    delete: (path: string) => Promise<{ ok: true } | { error: string }>;
  };
  screenshot: {
    /** Native macOS region capture; resolves once the user finishes or cancels the selection. */
    captureRegion: () => Promise<ScreenshotCaptureResult>;
    /** Read a saved screenshot back as a full-resolution data URL for the annotation editor. */
    readImage: (path: string) => Promise<{ dataUrl: string } | { error: string }>;
  };
  pickImage: () => Promise<
    { sourcePath: string; extension: string } | { error: string } | null
  >;
  saveProjectImage: (opts: {
    projectId: string;
    sourcePath: string;
    extension: string;
  }) => Promise<{ filename: string } | { error: string }>;
  getRuntimePort: () => Promise<number | null>;
  getUserDataDir: () => Promise<string>;
  getUserName: () => Promise<{ source: "git" | "os"; fullName: string; firstName: string }>;
  reload: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Sync the native window background with the renderer theme (dark/light)
   *  so resize gutters and the launch frame match the page ground. */
  setWindowBackgroundColor: (color: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Scale the whole UI via the window zoom factor (interface font scale). 1 = 100%. */
  setZoomFactor: (factor: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  notifications: {
    getPermission: () => Promise<"granted" | "unsupported">;
    showSessionFinished: (payload: {
      tag: string;
      title: string;
      body: string;
      projectId: string;
      taskId: string;
      worktreeId: string | null;
    }) => Promise<{ ok: true } | { ok: false; error: string }>;
    onSessionFinishedClick: (
      cb: (payload: {
        projectId: string;
        taskId: string;
        worktreeId: string | null;
      }) => void,
    ) => () => void;
  };
  cliCheck: (command: string, opts?: { verifyVersion?: boolean }) => Promise<CliCheckResult>;
  pty: {
    spawn: (opts: PtySpawnOptions) => Promise<{ ptyId: string }>;
    write: (ptyId: string, data: string) => Promise<boolean>;
    resize: (ptyId: string, cols: number, rows: number) => Promise<boolean>;
    kill: (ptyId: string) => Promise<boolean>;
    killLaunchProcesses: (opts: {
      cwd: string;
      commands: string[];
      ports?: number[];
    }) => Promise<LaunchProcessKillResult>;
    /** Kill every PTY whose cwd is inside `cwd` (e.g. before deleting a worktree). */
    killUnderPath: (cwd: string) => Promise<{ ptyCount: number }>;
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) => () => void;
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => () => void;
    replay: (ptyId: string) => Promise<{ data: string; nextSeq: number }>;
    /** Live agent PTY for a task (renderer reloads lose local pty ids). */
    findByTask: (taskId: string) => Promise<{ ptyId: string | null }>;
  };
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) => () => void;
  onCloseIntent: (cb: () => void) => () => void;
  /** Focused Session Mode: transform the main window into a small floating session card. */
  focusMode: {
    enter: (taskId: string) => Promise<FocusModeStateBridge>;
    exit: () => Promise<FocusModeStateBridge>;
    get: () => Promise<FocusModeStateBridge>;
    setAlwaysOnTop: (enabled: boolean) => Promise<FocusModeStateBridge>;
  };
  files: {
    list: (projectRoot: string) => Promise<FileListResult>;
    read: (projectRoot: string, relPath: string) => Promise<FileReadResult>;
    write: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null
    ) => Promise<FileWriteResult>;
    writeSensitive: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null
    ) => Promise<FileWriteResult>;
    watch: (
      projectRoot: string,
      relPath: string
    ) => Promise<{ ok: true; watchId: string } | { ok: false; error: string }>;
    unwatch: (watchId: string) => Promise<{ ok: true }>;
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => () => void;
  };
  preview: {
    startServer: (
      projectRoot: string
    ) => Promise<{ ok: true; port: number } | { ok: false; error: string }>;
  };
  sandbox: {
    // Phase 2: lifecycle is per-sandbox (sandboxId; omitted = the active scope).
    getState: (sandboxId?: string) => Promise<SandboxState>;
    getSettings: () => Promise<SandboxSettingsView>;
    updateSettings: (patch: SandboxSettingsPatch) => Promise<SandboxSettingsView>;
    up: (sandboxId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Tear down and restart with a forced default-image rebuild (update flow). */
    rebuild: (sandboxId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    down: (sandboxId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Destroy a sandbox's container + volumes. Call before deleting the DB row. */
    destroy: (sandboxId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Set the scope the renderer shows; routes remote PTY/fs/git. null = Local (host). */
    setActive: (sandboxId: string | null) => Promise<{ ok: true }>;
    connect: (sandboxId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    disconnect: (sandboxId?: string) => Promise<{ ok: true }>;
    status: () => Promise<{
      dockerAvailable: boolean;
      states: Array<{ sandboxId: string; state: SandboxState }>;
    }>;
    validateDockerfile: (
      path: string,
    ) => Promise<{ ok: true; exists: boolean; isDirectory: boolean }>;
    diagnostics: () => Promise<string>;
    /** Provision git/SSH auth in a sandbox; returns the generated public key (generate mode). */
    setupGitAuth: (sandboxId?: string) => Promise<{ publicKey?: string }>;
    /** npm install -g @agentsystemlabs/mission-control-agent@latest + systemctl restart on a remote VM. */
    upgradeAgent: (sandboxId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Read the saved remote VM bearer token (desktop-only). */
    revealApiKey: (
      sandboxId: string,
    ) => Promise<{ ok: true; apiKey: string } | { ok: false; error: string }>;
    /** Read a host project's origin remote URL (for prefilling a sandbox clone). */
    detectRemote: (projectPath: string) => Promise<string | null>;
    onStateChange: (cb: (e: { sandboxId: string; state: SandboxState }) => void) => () => void;
    onLog: (cb: (line: string) => void) => () => void;
  };
  remoteVm: {
    deploy: (input: RemoteVmDeployInput) => Promise<RemoteVmDeployResult>;
    startDeploy: (input: RemoteVmDeployInput) => Promise<{ jobId: string }>;
    listDeployJobs: () => Promise<RemoteVmDeployJobSnapshot[]>;
    getDeployLogs: (
      jobId: string,
      afterSeq?: number,
    ) => Promise<{ entries: RemoteVmDeployLogEntry[]; nextSeq: number }>;
    cancelDeploy: (jobId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Stop managed provider compute while preserving the remote workspace disk/volume. */
    pause: (sandboxId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /** Start managed provider compute and refresh the saved agent endpoint. */
    resume: (sandboxId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    /**
     * Sync a managed remote VM's saved status with the cloud provider's real
     * instance state (e.g. detect an idle-auto-stopped EC2 instance and mark it
     * paused). Safe to call on demand before switching to / resuming a sandbox.
     */
    reconcile: (sandboxId: string) => Promise<RemoteVmReconcileResult>;
    /**
     * Terminate the cloud VM for a sandbox. By default also removes the sandbox
     * row; pass `{ keepRow: true }` to terminate-only and let the server's delete
     * path handle row + project cleanup.
     */
    destroy: (
      sandboxId: string,
      opts?: { keepRow?: boolean },
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    onDeployUpdate: (cb: (job: RemoteVmDeployJobSnapshot) => void) => () => void;
    onDeployLog: (cb: (entry: RemoteVmDeployLogEntry) => void) => () => void;
  };
  remotePty: {
    spawn: (opts: RemotePtySpawnOptions) => Promise<{ ptyId: string }>;
    write: (ptyId: string, data: string) => Promise<boolean>;
    resize: (ptyId: string, cols: number, rows: number) => Promise<boolean>;
    kill: (ptyId: string) => Promise<boolean>;
    replay: (ptyId: string) => Promise<{ data: string; nextSeq: number }>;
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) => () => void;
    // exitCode shape matches the local pty.onExit so components can treat the two
    // PTY APIs as one type (the manager coerces undefined → 0).
    onExit: (
      cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void,
    ) => () => void;
    onSpawned: (cb: (msg: { ptyId: string }) => void) => () => void;
    onSpawnError: (
      cb: (msg: { ptyId: string; code: string; message: string }) => void,
    ) => () => void;
  };
  remoteFs: {
    list: (path: string) => Promise<FileListResult>;
    read: (path: string) => Promise<FileReadResult>;
    write: (
      path: string,
      content: string,
      expectedMtimeMs: number | null,
    ) => Promise<FileWriteResult>;
    watch: (path: string) => Promise<{ ok: true; watchId: string } | { ok: false; error: string }>;
    unwatch: (watchId: string) => Promise<{ ok: true }>;
    onChange: (cb: (msg: { watchId: string; path: string; mtimeMs: number }) => void) => () => void;
  };
  remoteGit: {
    status: (repo: string) => Promise<GitStatus>;
    diff: (repo: string, file: string, staged: boolean) => Promise<GitDiff>;
    clone: (
      remote: string,
      slug: string,
      branch?: string,
    ) => Promise<{ slug: string; path: string }>;
  };
};
