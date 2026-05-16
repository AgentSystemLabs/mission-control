export const FILE_READ_ERRORS = ["invalid-path", "not-found", "binary", "too-large"] as const;
export const FILE_WRITE_ERRORS = ["invalid-path", "invalid-content", "stale"] as const;

export type FileReadError = (typeof FILE_READ_ERRORS)[number];
export type FileWriteError = (typeof FILE_WRITE_ERRORS)[number];

export type FileListResult = { ok: true; files: string[] } | { ok: false; error: string };

export type FileReadResult =
  | { ok: true; content: string; mtimeMs: number; lineCount: number }
  | { ok: false; error: FileReadError | string; lineCount?: number };

export type FileWriteResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; error: FileWriteError | string; currentMtimeMs?: number };

export type LatestSkillsManifest = {
  version: string;
  downloadUrl: string;
  sha256: string;
  size: number;
};

export type InstallSkillsArgs = {
  projectPath: string;
  harnesses: { claude: boolean; codex: boolean };
  baseUrl?: string;
  licenseKey?: string;
};

export type InstallSkillsResult = {
  version: string;
  claudeInstalled: boolean;
  codexInstalled: boolean;
  skillCount: number;
};

export type LaunchProcessKillResult = {
  ptyCount: number;
  ports: Array<{
    port: number;
    pids: number[];
    killed: number[];
    errors: string[];
  }>;
};

export type ElectronBridge = {
  installSkills: {
    fetchLatest: (opts?: {
      baseUrl?: string;
      licenseKey?: string;
    }) => Promise<
      | { ok: true; manifest: LatestSkillsManifest }
      | { ok: false; error: string }
    >;
    run: (
      args: InstallSkillsArgs,
    ) => Promise<{ ok: true; result: InstallSkillsResult } | { ok: false; error: string }>;
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
  cliCheck: (
    command: string
  ) => Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
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
    }) => Promise<{ ptyId: string }>;
    write: (ptyId: string, data: string) => Promise<boolean>;
    resize: (ptyId: string, cols: number, rows: number) => Promise<boolean>;
    kill: (ptyId: string) => Promise<boolean>;
    killLaunchProcesses: (opts: {
      cwd: string;
      commands: string[];
      ports?: number[];
    }) => Promise<LaunchProcessKillResult>;
    onData: (cb: (msg: { ptyId: string; data: string }) => void) => () => void;
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => () => void;
    replay: (ptyId: string) => Promise<string>;
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
    watch: (
      projectRoot: string,
      relPath: string
    ) => Promise<{ ok: true; watchId: string } | { ok: false; error: string }>;
    unwatch: (watchId: string) => Promise<{ ok: true }>;
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => () => void;
  };
};
