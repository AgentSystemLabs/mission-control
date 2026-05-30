import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import { resolveInsideWorkspace } from "./workspace-guard";
import type { FsChangeMessage } from "./protocol";

// Mirrors electron/file-handlers.ts limits so the sandbox file browser behaves
// like the host one.
const MAX_FILES = 50_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LINES = 1_000;
const BINARY_SNIFF_BYTES = 8192;

const IMAGE_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

export type FsListResult = { ok: true; files: string[] } | { ok: false; error: string };
export type FsReadResult =
  | { ok: true; kind: "text"; content: string; mtimeMs: number; lineCount: number }
  | { ok: true; kind: "image"; dataUrl: string; mimeType: string; size: number; mtimeMs: number }
  | { ok: false; error: string };
export type FsWriteResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; error: string; currentMtimeMs?: number };
export type FsWatchResult = { ok: true; watchId: string } | { ok: false; error: string };
export type FsUnwatchResult = { ok: true };

// Deny-list mirrored from electron/file-handlers.ts. Unlike the host (which can
// pop a native "allow write?" dialog), the container has no UI to escalate, so
// these writes are refused outright — the file browser cannot clobber agent
// hook config, git internals, or lockfiles through the RPC.
const SENSITIVE_SEGMENTS = new Set([
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

function isSensitiveRel(relPosix: string): boolean {
  const segments = relPosix.split("/").filter(Boolean);
  if (segments.length === 1 && SENSITIVE_ROOT_FILES.has(segments[0]!.toLowerCase())) return true;
  return segments.some(
    (s) => SENSITIVE_SEGMENTS.has(s.toLowerCase()) || s.toLowerCase() === "hooks",
  );
}

function listFiles(root: string): string[] {
  const ig = ignore().add([".git", "node_modules"]);
  try {
    ig.add(fs.readFileSync(path.join(root, ".gitignore"), "utf8"));
  } catch {
    // no .gitignore — default ignores still apply
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const relPosix = path.relative(root, abs).split(path.sep).join("/");
      if (ig.ignores(entry.isDirectory() ? `${relPosix}/` : relPosix)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(relPosix);
    }
  };
  walk(root);
  return out;
}

function readFileResult(abs: string): FsReadResult {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { ok: false, error: "not-found" };
  }
  if (!stat.isFile()) return { ok: false, error: "not-found" };

  const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
  if (mime) {
    if (stat.size > MAX_BYTES) return { ok: false, error: "too-large" };
    const buf = fs.readFileSync(abs);
    return {
      ok: true,
      kind: "image",
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      mimeType: mime,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }

  if (stat.size > MAX_BYTES) return { ok: false, error: "too-large" };
  const buf = fs.readFileSync(abs);
  const sniff = buf.subarray(0, Math.min(buf.length, BINARY_SNIFF_BYTES));
  if (sniff.includes(0)) return { ok: false, error: "binary" };

  const content = buf.toString("utf8");
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  if (lineCount > MAX_LINES) return { ok: false, error: "too-large" };
  return { ok: true, kind: "text", content, mtimeMs: stat.mtimeMs, lineCount };
}

/**
 * File operations confined to the sandbox workspace, served over WS RPC so the
 * host's file browser + editor read the in-container repo. `path`/`repo` params
 * are absolute container paths; every one is re-validated against the workspace
 * prefix before any fs access.
 */
export class FileRpc {
  private readonly watchers = new Map<
    string,
    { watcher: fs.FSWatcher; lastMtimeMs: number }
  >();
  private nextWatchId = 1;

  constructor(
    private readonly workspaceRoot: string,
    private readonly emit: (msg: FsChangeMessage) => void,
  ) {}

  list(params: { path: string }): FsListResult {
    const abs = resolveInsideWorkspace(this.workspaceRoot, params.path);
    if (!abs) return { ok: false, error: "invalid-path" };
    try {
      return { ok: true, files: listFiles(abs) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  read(params: { path: string }): FsReadResult {
    const abs = resolveInsideWorkspace(this.workspaceRoot, params.path);
    if (!abs) return { ok: false, error: "invalid-path" };
    try {
      return readFileResult(abs);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  write(params: { path: string; content: string; expectedMtimeMs?: number | null }): FsWriteResult {
    const abs = resolveInsideWorkspace(this.workspaceRoot, params.path);
    if (!abs) return { ok: false, error: "invalid-path" };
    if (typeof params.content !== "string") return { ok: false, error: "invalid-content" };

    const relPosix = path.relative(this.workspaceRoot, abs).split(path.sep).join("/");
    if (isSensitiveRel(relPosix)) return { ok: false, error: "protected-path" };

    if (params.expectedMtimeMs != null) {
      try {
        const cur = fs.statSync(abs);
        if (cur.mtimeMs > params.expectedMtimeMs + 1) {
          return { ok: false, error: "stale", currentMtimeMs: cur.mtimeMs };
        }
      } catch {
        // file doesn't exist yet — treat as a fresh create
      }
    }

    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, params.content, "utf8");
      return { ok: true, mtimeMs: fs.statSync(abs).mtimeMs };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  watch(params: { path: string }): FsWatchResult {
    const abs = resolveInsideWorkspace(this.workspaceRoot, params.path);
    if (!abs) return { ok: false, error: "invalid-path" };

    const watchId = String(this.nextWatchId++);
    let lastMtimeMs = 0;
    try {
      lastMtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      // watching a not-yet-existing path is allowed
    }
    try {
      const watcher = fs.watch(abs, { persistent: false }, () => {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(abs).mtimeMs;
        } catch {
          return;
        }
        const entry = this.watchers.get(watchId);
        if (!entry || mtimeMs === entry.lastMtimeMs) return;
        entry.lastMtimeMs = mtimeMs;
        this.emit({ type: "fs.change", watchId, path: params.path, mtimeMs });
      });
      this.watchers.set(watchId, { watcher, lastMtimeMs });
      return { ok: true, watchId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  unwatch(params: { watchId: string }): FsUnwatchResult {
    const entry = this.watchers.get(params.watchId);
    if (entry) {
      try {
        entry.watcher.close();
      } catch {
        // ignore
      }
      this.watchers.delete(params.watchId);
    }
    return { ok: true };
  }

  closeAll(): void {
    for (const { watcher } of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    this.watchers.clear();
  }
}
