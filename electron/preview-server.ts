import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log/main";

// A tiny static file server for the file editor's HTML preview. One instance per
// project root (cached by realpath), bound to loopback on an ephemeral port. It
// exists so the preview iframe can load a real `http://127.0.0.1:PORT` document —
// relative + root-absolute assets resolve and scripts run, exactly like opening
// the file in a browser — instead of an inert sandboxed `srcDoc` that renders
// nothing for any page that depends on external files or JavaScript.
//
// Threat model: the port is reachable by any process on the machine while it is
// up, so access is narrowed to (a) loopback bind only, (b) a Host-header
// allow-list (blunts DNS-rebinding from a page in the user's browser), (c)
// path-traversal + symlink-escape rejection so only files under the project root
// are served, and (d) a short idle timeout + dispose-on-quit so the exposure
// window is small. This mirrors the posture of the Vite dev server this app
// already runs on loopback.

const IDLE_TIMEOUT_MS = 10 * 60_000;

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "text/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

type PreviewServer = {
  server: http.Server;
  port: number;
  root: string;
  idleTimer: NodeJS.Timeout | null;
};

// Keyed by realpath'd project root.
const servers = new Map<string, PreviewServer>();

// Reject any request whose Host header isn't loopback. A page in the user's
// normal browser can be tricked (DNS rebinding) into resolving an
// attacker-controlled hostname to 127.0.0.1 and issuing requests here; the
// browser sends the *original* hostname in the Host header, so pinning Host to
// loopback drops those while allowing the Electron iframe (which addresses the
// server as 127.0.0.1/localhost directly).
export function isLoopbackHost(hostHeader: string | undefined | null): boolean {
  if (!hostHeader) return false;
  const trimmed = hostHeader.trim();
  const host = trimmed.startsWith("[")
    ? trimmed.slice(0, trimmed.indexOf("]") + 1).toLowerCase()
    : trimmed.split(":")[0]!.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

// Pure decode + traversal/null-byte rejection (no filesystem access). Returns the
// normalized root-relative path, or null if the request escapes the root.
export function urlPathToRel(root: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rel = decoded.replace(/^\/+/, "");
  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) return null;
  return relCheck;
}

function resolveServableFile(root: string, urlPathname: string): { abs: string; size: number } | null {
  const rel = urlPathToRel(root, urlPathname);
  if (rel === null) return null;
  let abs = path.resolve(root, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    abs = path.join(abs, "index.html");
    try {
      stat = fs.statSync(abs);
    } catch {
      return null;
    }
  }
  if (!stat.isFile()) return null;
  // Symlink-escape guard: the real file must still live under the real root, so a
  // repo can't ship `link.html -> /etc/passwd` and have the server follow it out.
  try {
    const realRoot = fs.realpathSync(root);
    const realAbs = fs.realpathSync(abs);
    const realRel = path.relative(realRoot, realAbs);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
  } catch {
    return null;
  }
  return { abs, size: stat.size };
}

function contentType(abs: string): string {
  return MIME_BY_EXT[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
}

function serveFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  abs: string,
  size: number,
): void {
  const baseHeaders: http.OutgoingHttpHeaders = {
    "Content-Type": contentType(abs),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  // Range support so <video>/<audio> can seek (and Chromium can start playback).
  const range = req.headers.range;
  if (range && size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const hasStart = m[1] !== "";
      const hasEnd = m[2] !== "";
      let start: number;
      let end: number;
      if (hasStart) {
        start = parseInt(m[1]!, 10);
        end = hasEnd ? parseInt(m[2]!, 10) : size - 1;
      } else if (hasEnd) {
        start = Math.max(0, size - parseInt(m[2]!, 10));
        end = size - 1;
      } else {
        start = 0;
        end = size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      end = Math.min(end, size - 1);
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = fs.createReadStream(abs, { start, end });
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...baseHeaders, "Content-Length": size });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(abs);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function handleRequest(rec: PreviewServer, req: http.IncomingMessage, res: http.ServerResponse): void {
  resetIdle(rec);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  if (!isLoopbackHost(req.headers.host)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  let pathname: string;
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    res.writeHead(400);
    res.end("bad request");
    return;
  }
  const found = resolveServableFile(rec.root, pathname);
  if (!found) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  serveFile(req, res, found.abs, found.size);
}

function resetIdle(rec: PreviewServer): void {
  if (rec.idleTimer) clearTimeout(rec.idleTimer);
  rec.idleTimer = setTimeout(() => stopPreviewServer(rec.root), IDLE_TIMEOUT_MS);
  rec.idleTimer.unref?.();
}

export type StartPreviewServerResult = { ok: true; port: number } | { ok: false; error: string };

export async function startPreviewServer(projectRoot: string): Promise<StartPreviewServerResult> {
  if (!projectRoot || typeof projectRoot !== "string") {
    return { ok: false, error: "invalid-root" };
  }
  let root: string;
  try {
    root = fs.realpathSync(path.resolve(projectRoot));
    if (!fs.statSync(root).isDirectory()) return { ok: false, error: "invalid-root" };
  } catch {
    return { ok: false, error: "invalid-root" };
  }

  const existing = servers.get(root);
  if (existing) {
    resetIdle(existing);
    return { ok: true, port: existing.port };
  }

  return await new Promise<StartPreviewServerResult>((resolve) => {
    const server = http.createServer((req, res) => {
      const rec = servers.get(root);
      if (!rec) {
        res.writeHead(503);
        res.end();
        return;
      }
      try {
        handleRequest(rec, req, res);
      } catch (err) {
        log.error("preview-server.request-failed", { error: String(err) });
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    server.once("error", (err) => {
      log.error("preview-server.listen-failed", { root, error: String(err) });
      resolve({ ok: false, error: String(err) });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      if (!port) {
        try {
          server.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, error: "no-port" });
        return;
      }
      const rec: PreviewServer = { server, port, root, idleTimer: null };
      servers.set(root, rec);
      resetIdle(rec);
      log.info("preview-server.started", { root, port });
      resolve({ ok: true, port });
    });
  });
}

export function stopPreviewServer(root: string): void {
  const rec = servers.get(root);
  if (!rec) return;
  servers.delete(root);
  if (rec.idleTimer) clearTimeout(rec.idleTimer);
  try {
    rec.server.closeAllConnections?.();
    rec.server.close();
  } catch {
    /* already closing */
  }
  log.info("preview-server.stopped", { root });
}

export function disposeAllPreviewServers(): void {
  for (const root of [...servers.keys()]) stopPreviewServer(root);
}
