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

export type SessionTerminalDebugLogInput = {
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

export type SessionTerminalDebugLogEntry = SessionTerminalDebugLogInput & {
  id: string;
  level: "error" | "warn";
  source: "pty-manager" | "renderer";
  createdAt: string;
  platform: NodeJS.Platform;
  arch: string;
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
};

export type ShellPtySpawnOptions = BasePtySpawnOptions & {
  shell: true;
  agent?: never;
  dangerouslySkipPermissions?: never;
};

export type PtySpawnOptions = AgentPtySpawnOptions | ShellPtySpawnOptions;

export type RemotePtySpawnOptions = {
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

export type SandboxRuntimeMode = "host" | "docker";
export type SandboxGitAuthMode = "none" | "copy-host" | "generate";

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
  agentConfigVolume: string;
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
  agentConfigVolume: string;
  gitAuthMode: SandboxGitAuthMode;
}>;

export type ElectronBridge = {
  settings: {
    getToken: () => Promise<string>;
    regenerateToken: () => Promise<string>;
  };
  debugLog: {
    listSessionTerminalErrors: () => Promise<SessionTerminalDebugLogEntry[]>;
    clearSessionTerminalErrors: () => Promise<{ ok: true }>;
    recordSessionTerminalError: (
      input: SessionTerminalDebugLogInput,
    ) => Promise<SessionTerminalDebugLogEntry>;
  };
  getPathForFile: (file: File) => string;
  browseFolder: () => Promise<string | null>;
  openPath: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<{ ok: true }>;
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
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) => () => void;
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => () => void;
    replay: (ptyId: string) => Promise<{ data: string; nextSeq: number }>;
  };
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) => () => void;
  onCloseIntent: (cb: () => void) => () => void;
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
    /** Read the saved remote VM bearer token (desktop-only). */
    revealApiKey: (
      sandboxId: string,
    ) => Promise<{ ok: true; apiKey: string } | { ok: false; error: string }>;
    /** Read a host project's origin remote URL (for prefilling a sandbox clone). */
    detectRemote: (projectPath: string) => Promise<string | null>;
    onStateChange: (cb: (e: { sandboxId: string; state: SandboxState }) => void) => () => void;
    onLog: (cb: (line: string) => void) => () => void;
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
    clone: (remote: string, slug: string) => Promise<{ slug: string; path: string }>;
  };
};
