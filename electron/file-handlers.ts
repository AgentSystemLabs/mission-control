import { dialog, type BrowserWindow, type IpcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import { FILE_READ_MAX_BYTES, FILE_READ_MAX_LINES } from "../src/shared/file-read-limits";
import { IPC } from "./ipc-channels";
import { safeHandle } from "./ipc-safe-handle";

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
const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
} as const;

type WatchEntry = {
  watcher: fs.FSWatcher;
  abs: string;
  lastMtimeMs: number;
};

const watchers = new Map<string, WatchEntry>();
let nextWatchId = 1;

function sendToLiveWindow(
  win: BrowserWindow | null,
  channel: string,
  payload: unknown,
): boolean {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  win.webContents.send(channel, payload);
  return true;
}

// Paths that auto-execute on routine user actions (next prompt, next git op,
// next install, next IDE open). Writing any of these via the generic
// `files:write` IPC would let a compromised renderer plant persistent code
// execution without ever invoking the PTY. Sensitive writes must go through
// `files:writeSensitive`, which surfaces a native OS confirm dialog.
//
// Match is applied against the *resolved* relative path, after symlink and
// `./` normalization (see `resolveInsideRoot`).
const SENSITIVE_DIR_SEGMENTS = new Set([
  ".claude",
  ".codex",
  ".cursor",
  ".git",
  ".husky",
  ".vscode",
  ".devcontainer",
]);

const SENSITIVE_ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".envrc",
]);

// macOS APFS is case-insensitive by default, so `.Claude/settings.local.json`
// and `Package.JSON` resolve to the same OS object as the canonical lowercase
// form. The classifier matches on lowercased segments so case variants can't
// dodge the deny-list.
export function isSensitiveRelPath(relPath: string): boolean {
  if (!relPath) return false;
  const normalized = relPath.split(path.sep).join("/").replace(/^\/+/, "");
  if (!normalized) return false;
  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  if (segments.length === 1 && SENSITIVE_ROOT_FILES.has(segments[0]!.toLowerCase())) {
    return true;
  }
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (SENSITIVE_DIR_SEGMENTS.has(lower)) return true;
    // `hooks` anywhere in the path — covers .husky/hooks, custom hook dirs,
    // and generic agent-config schemas that nest a hooks folder under a
    // non-dotted root.
    if (lower === "hooks") return true;
  }
  return false;
}

// Computes the post-normalization and post-realpath relatives for an `abs`
// already verified by `resolveInsideRoot`. The sensitive-path deny-list runs
// against BOTH:
//   - the normalized relative (`path.relative(root, abs)`) — collapses `..`
//     and `.` traversal so `src/../.git/hooks/x` can't slip past as
//     `["src", "..", ".git", ...]`.
//   - the realpath relative (when the file exists) — catches symlink
//     laundering where `docs/readme.md` → `.git/hooks/pre-commit`.
function resolvedRelsForCheck(
  projectRoot: string,
  abs: string,
): { normalizedRel: string; realRel: string | null } {
  const root = path.resolve(projectRoot);
  const normalizedRel = path.relative(root, abs);
  let realRel: string | null = null;
  try {
    if (fs.existsSync(abs)) {
      const realRoot = fs.realpathSync(root);
      const realAbs = fs.realpathSync(abs);
      realRel = path.relative(realRoot, realAbs);
    }
  } catch {
    realRel = null;
  }
  return { normalizedRel, realRel };
}

export function isSensitiveAbs(projectRoot: string, abs: string): boolean {
  const { normalizedRel, realRel } = resolvedRelsForCheck(projectRoot, abs);
  if (isSensitiveRelPath(normalizedRel)) return true;
  if (realRel && isSensitiveRelPath(realRel)) return true;
  return false;
}

// Renderer-supplied strings can carry control characters that, when rendered
// in the native confirm dialog, hide or obscure the path the user is approving
// (extra newlines push "Allow write" off-screen; CR can overwrite the line).
// We sanitize only what is shown to the user; the *write* still goes to the
// canonical resolved path.
function sanitizeDisplayPath(relPath: string): string {
  // Strip C0 control bytes and DEL. Done by char-code rather than a
  // /[\u0000-\u001f\u007f]/ regex so the source file contains no literal
  // control bytes (which break grep/diff tools that auto-detect binary).
  let out = "";
  for (let i = 0; i < relPath.length; i++) {
    const code = relPath.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue;
    out += relPath[i];
    if (out.length >= 200) {
      return out.slice(0, 197) + "...";
    }
  }
  return out;
}

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

export function imageMimeForRelPath(relPath: string): (typeof IMAGE_MIME_BY_EXT)[keyof typeof IMAGE_MIME_BY_EXT] | null {
  const ext = path.extname(relPath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext as keyof typeof IMAGE_MIME_BY_EXT] ?? null;
}

export function registerFileHandlers(ipc: IpcMain, getWin: () => BrowserWindow | null) {
  safeHandle(IPC.filesList, async (_evt, projectRoot: string) => {
    if (!projectRoot || typeof projectRoot !== "string") {
      return { ok: false as const, error: "invalid root" };
    }
    try {
      const files = listFiles(projectRoot);
      return { ok: true as const, files };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  }, ipc);

  safeHandle(
    IPC.filesRead,
    async (_evt, projectRoot: string, relPath: string) => {
      const abs = resolveInsideRoot(projectRoot, relPath);
      if (!abs) return { ok: false as const, error: "invalid-path" as const };
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return { ok: false as const, error: "not-found" as const };
        if (stat.size > FILE_READ_MAX_BYTES) {
          return { ok: false as const, error: "too-large" as const, lineCount: -1 };
        }
        const buf = fs.readFileSync(abs);
        const imageMimeType = imageMimeForRelPath(relPath);
        if (imageMimeType) {
          return {
            ok: true as const,
            kind: "image" as const,
            dataUrl: `data:${imageMimeType};base64,${buf.toString("base64")}`,
            mimeType: imageMimeType,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          };
        }
        if (isProbablyBinary(buf)) {
          return { ok: false as const, error: "binary" as const };
        }
        const content = buf.toString("utf8");
        // Count lines (newlines + 1 if non-empty trailing chars).
        let lineCount = 1;
        for (let i = 0; i < content.length; i++) {
          if (content.charCodeAt(i) === 10) lineCount++;
        }
        if (lineCount > FILE_READ_MAX_LINES) {
          return { ok: false as const, error: "too-large" as const, lineCount };
        }
        return {
          ok: true as const,
          kind: "text" as const,
          content,
          mtimeMs: stat.mtimeMs,
          lineCount,
        };
      } catch (err: any) {
        if (err?.code === "ENOENT") return { ok: false as const, error: "not-found" as const };
        return { ok: false as const, error: String(err) };
      }
    },
    ipc,
  );

  function writeAtPath(
    abs: string,
    content: string,
    expectedMtimeMs: number | null,
  ):
    | { ok: true; mtimeMs: number }
    | { ok: false; error: "stale" | string; currentMtimeMs?: number } {
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

  safeHandle(
    IPC.filesWrite,
    async (
      _evt,
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ) => {
      const abs = resolveInsideRoot(projectRoot, relPath);
      if (!abs) return { ok: false as const, error: "invalid-path" as const };
      if (typeof content !== "string") return { ok: false as const, error: "invalid-content" as const };
      // Check sensitivity against the *resolved* path (post `..`/`.` normalize
      // + post-realpath), not the renderer-supplied string. Inputs like
      // `src/../.git/hooks/x` or symlink-laundered targets get caught here.
      if (isSensitiveAbs(projectRoot, abs)) {
        return { ok: false as const, error: "protected-path" as const };
      }
      return writeAtPath(abs, content, expectedMtimeMs);
    },
    ipc,
  );

  safeHandle(
    IPC.filesWriteSensitive,
    async (
      _evt,
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ) => {
      const abs = resolveInsideRoot(projectRoot, relPath);
      if (!abs) return { ok: false as const, error: "invalid-path" as const };
      if (typeof content !== "string") return { ok: false as const, error: "invalid-content" as const };
      // Defensive: if a non-sensitive path arrives here, route it through the
      // normal write — no reason to put the user through a confirm dialog for
      // an ordinary source file.
      if (!isSensitiveAbs(projectRoot, abs)) {
        return writeAtPath(abs, content, expectedMtimeMs);
      }
      const win = getWin();
      // No backing window means there's no renderer that legitimately initiated
      // this call (the renderer is the only caller). Treat as cancel rather
      // than open an orphan app-modal dialog the user wouldn't associate with MC.
      if (!win) {
        return { ok: false as const, error: "user-declined" as const };
      }
      // Show the canonical resolved path (sanitized of control bytes) so a
      // malicious renderer can't push "Allow write" off-screen with embedded
      // newlines or obscure the actual target with `..` traversal noise.
      const root = path.resolve(projectRoot);
      const displayPath = sanitizeDisplayPath(path.relative(root, abs));
      const message =
        "Mission Control is about to modify a file that controls automatic command execution.";
      const detail =
        `File: ${displayPath}\n\n` +
        "Files like .claude/settings.local.json, .git/hooks/*, package.json, and " +
        ".vscode/tasks.json can run commands automatically the next time you use " +
        "an agent, run git, or install packages. Only allow this if you intended " +
        "to edit this file.";
      const confirm = await dialog.showMessageBox(win, {
        type: "warning",
        title: "Allow write to protected file?",
        message,
        detail,
        buttons: ["Cancel", "Allow write"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirm.response !== 1) {
        return { ok: false as const, error: "user-declined" as const };
      }
      return writeAtPath(abs, content, expectedMtimeMs);
    },
    ipc,
  );

  safeHandle(IPC.filesWatch, async (_evt, projectRoot: string, relPath: string) => {
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
        if (!sendToLiveWindow(win, IPC.filesChanged, { watchId, mtimeMs: cur.mtimeMs })) {
          try {
            entry.watcher.close();
          } catch {}
          watchers.delete(watchId);
        }
      });
      entry.watcher = watcher;
      watchers.set(watchId, entry);
      return { ok: true as const, watchId };
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
  }, ipc);

  safeHandle(IPC.filesUnwatch, async (_evt, watchId: string) => {
    const entry = watchers.get(watchId);
    if (!entry) return { ok: true as const };
    try {
      entry.watcher.close();
    } catch {}
    watchers.delete(watchId);
    return { ok: true as const };
  }, ipc);
}

export function disposeAllFileWatchers() {
  for (const e of watchers.values()) {
    try {
      e.watcher.close();
    } catch {}
  }
  watchers.clear();
}
