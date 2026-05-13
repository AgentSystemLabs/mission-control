import type { BrowserWindow, IpcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import { IPC } from "./ipc-channels";

const HARDCODED_IGNORES = [
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  "dist-server",
  ".next",
  ".turbo",
  "build",
  "coverage",
  ".cache",
  ".worktrees",
  "out",
  ".vite",
  ".parcel-cache",
  ".output",
];

const MAX_FILES = 50_000;
const MAX_LINES = 1000;
const MAX_BYTES = 5 * 1024 * 1024;

type WatchEntry = {
  watcher: fs.FSWatcher;
  abs: string;
  lastMtimeMs: number;
};

const watchers = new Map<string, WatchEntry>();
let nextWatchId = 1;

function resolveInsideRoot(projectRoot: string, relPath: string): string | null {
  if (!projectRoot || !relPath) return null;
  if (relPath.includes("\0")) return null;
  const root = path.resolve(projectRoot);
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  // Symlink check: if the target exists, resolve realpaths and ensure the real
  // file is still inside the real project root. Prevents a repo from shipping
  // a symlink that escapes the root (e.g. → ~/.ssh/id_rsa).
  try {
    if (fs.existsSync(abs)) {
      const realRoot = fs.realpathSync(root);
      const realAbs = fs.realpathSync(abs);
      const realRel = path.relative(realRoot, realAbs);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
    }
  } catch {
    return null;
  }
  return abs;
}

function loadGitignore(projectRoot: string) {
  const ig = ignore();
  ig.add(HARDCODED_IGNORES);
  try {
    const gi = path.join(projectRoot, ".gitignore");
    if (fs.existsSync(gi)) {
      ig.add(fs.readFileSync(gi, "utf8"));
    }
  } catch {
    // best-effort
  }
  // Re-include common dev dotfiles that .gitignore typically excludes but
  // developers expect to find in the file finder.
  ig.add("!.env");
  ig.add("!.env.*");
  return ig;
}

function listFiles(projectRoot: string): string[] {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const ig = loadGitignore(root);
  const out: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const relDir = stack.pop()!;
    const absDir = path.join(root, relDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // Skip symlinks entirely — both to prevent walker cycles and to prevent
      // a malicious repo from indexing files outside the project root.
      if (e.isSymbolicLink()) continue;
      const relPath = relDir ? path.join(relDir, e.name) : e.name;
      // ignore expects POSIX-style separators
      const igPath = relPath.split(path.sep).join("/");
      if (e.isDirectory()) {
        if (ig.ignores(igPath + "/")) continue;
        stack.push(relPath);
      } else if (e.isFile()) {
        if (ig.ignores(igPath)) continue;
        out.push(igPath);
        if (out.length >= MAX_FILES) break;
      }
    }
  }
  return out;
}

function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function registerFileHandlers(
  ipc: IpcMain,
  getWin: () => BrowserWindow | null,
  resolveProjectPath: (projectId: string) => Promise<string | null>,
) {
  ipc.handle(IPC.filesList, async (_evt, projectId: string) => {
    if (!projectId || typeof projectId !== "string") {
      return { ok: false as const, error: "invalid-project" };
    }
    const projectRoot = await resolveProjectPath(projectId);
    if (!projectRoot) return { ok: false as const, error: "unknown-project" };
    try {
      const files = listFiles(projectRoot);
      return { ok: true as const, files };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

  ipc.handle(
    IPC.filesRead,
    async (_evt, projectId: string, relPath: string) => {
      const projectRoot = await resolveProjectPath(projectId);
      if (!projectRoot) return { ok: false as const, error: "unknown-project" as const };
      const abs = resolveInsideRoot(projectRoot, relPath);
      if (!abs) return { ok: false as const, error: "invalid-path" as const };
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return { ok: false as const, error: "not-found" as const };
        if (stat.size > MAX_BYTES) {
          return { ok: false as const, error: "too-large" as const, lineCount: -1 };
        }
        const buf = fs.readFileSync(abs);
        if (isProbablyBinary(buf)) {
          return { ok: false as const, error: "binary" as const };
        }
        const content = buf.toString("utf8");
        // Count lines (newlines + 1 if non-empty trailing chars).
        let lineCount = 1;
        for (let i = 0; i < content.length; i++) {
          if (content.charCodeAt(i) === 10) lineCount++;
        }
        if (lineCount > MAX_LINES) {
          return { ok: false as const, error: "too-large" as const, lineCount };
        }
        return {
          ok: true as const,
          content,
          mtimeMs: stat.mtimeMs,
          lineCount,
        };
      } catch (err: any) {
        if (err?.code === "ENOENT") return { ok: false as const, error: "not-found" as const };
        return { ok: false as const, error: String(err) };
      }
    }
  );

  ipc.handle(
      IPC.filesWrite,
    async (
      _evt,
      projectId: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ) => {
      const projectRoot = await resolveProjectPath(projectId);
      if (!projectRoot) return { ok: false as const, error: "unknown-project" as const };
      const abs = resolveInsideRoot(projectRoot, relPath);
      if (!abs) return { ok: false as const, error: "invalid-path" as const };
      if (typeof content !== "string") return { ok: false as const, error: "invalid-content" as const };
      try {
        if (expectedMtimeMs != null) {
          try {
            const cur = fs.statSync(abs);
            // Allow small skew (1ms); if mtime advanced, treat as stale.
            if (cur.mtimeMs > expectedMtimeMs + 1) {
              return { ok: false as const, error: "stale" as const, currentMtimeMs: cur.mtimeMs };
            }
          } catch (err: any) {
            if (err?.code !== "ENOENT") throw err;
          }
        }
        fs.writeFileSync(abs, content, "utf8");
        const stat = fs.statSync(abs);
        return { ok: true as const, mtimeMs: stat.mtimeMs };
      } catch (err) {
        return { ok: false as const, error: String(err) };
      }
    }
  );

  ipc.handle(IPC.filesWatch, async (_evt, projectId: string, relPath: string) => {
    const projectRoot = await resolveProjectPath(projectId);
    if (!projectRoot) return { ok: false as const, error: "unknown-project" as const };
    const abs = resolveInsideRoot(projectRoot, relPath);
    if (!abs) return { ok: false as const, error: "invalid-path" as const };
    try {
      const stat = fs.statSync(abs);
      const watchId = String(nextWatchId++);
      const entry: WatchEntry = { watcher: null as any, abs, lastMtimeMs: stat.mtimeMs };
      const watcher = fs.watch(abs, { persistent: false }, () => {
        // fs.watch can fire spuriously; re-stat and dedupe by mtime.
        let cur: fs.Stats;
        try {
          cur = fs.statSync(abs);
        } catch {
          return;
        }
        if (cur.mtimeMs <= entry.lastMtimeMs) return;
        entry.lastMtimeMs = cur.mtimeMs;
        const win = getWin();
      win?.webContents.send(IPC.filesChanged, { watchId, mtimeMs: cur.mtimeMs });
      });
      entry.watcher = watcher;
      watchers.set(watchId, entry);
      return { ok: true as const, watchId };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  });

  ipc.handle(IPC.filesUnwatch, async (_evt, watchId: string) => {
    const entry = watchers.get(watchId);
    if (!entry) return { ok: true as const };
    try {
      entry.watcher.close();
    } catch {}
    watchers.delete(watchId);
    return { ok: true as const };
  });
}

export function disposeAllFileWatchers() {
  for (const e of watchers.values()) {
    try {
      e.watcher.close();
    } catch {}
  }
  watchers.clear();
}
