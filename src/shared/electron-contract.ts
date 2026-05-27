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
};
