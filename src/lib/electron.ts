// Thin client-side wrapper for the Electron preload bridge.

export type ElectronBridge = {
  browseFolder: () => Promise<string | null>;
  getRuntimePort: () => Promise<number | null>;
  getUserDataDir: () => Promise<string>;
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
