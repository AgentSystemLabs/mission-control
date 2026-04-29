// Thin client-side wrapper for the Electron preload bridge.

export type ElectronBridge = {
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
    onData: (cb: (msg: { ptyId: string; data: string }) => void) => () => void;
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => () => void;
    replay: (ptyId: string) => Promise<string>;
  };
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) => () => void;
  onCloseIntent: (cb: () => void) => () => void;
  files: {
    list: (
      projectRoot: string,
    ) => Promise<{ ok: true; files: string[] } | { ok: false; error: string }>;
    read: (
      projectRoot: string,
      relPath: string,
    ) => Promise<
      | { ok: true; content: string; mtimeMs: number; lineCount: number }
      | {
          ok: false;
          error: "invalid-path" | "not-found" | "binary" | "too-large" | string;
          lineCount?: number;
        }
    >;
    write: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ) => Promise<
      | { ok: true; mtimeMs: number }
      | {
          ok: false;
          error: "invalid-path" | "invalid-content" | "stale" | string;
          currentMtimeMs?: number;
        }
    >;
    watch: (
      projectRoot: string,
      relPath: string,
    ) => Promise<{ ok: true; watchId: string } | { ok: false; error: string }>;
    unwatch: (watchId: string) => Promise<{ ok: true }>;
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => () => void;
  };
};

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

export function getElectron(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

export function isElectron(): boolean {
  return getElectron() !== null;
}
