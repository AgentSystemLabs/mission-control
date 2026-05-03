import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const entry = process.env.SERVER_ENTRY;
const port = Number(process.env.PORT);
const host = process.env.HOST || "127.0.0.1";

if (!entry) {
  console.error("[server-runner] SERVER_ENTRY env not set");
  process.exit(1);
}

const mod = await import(pathToFileURL(entry).href);
const handler = mod.default ?? mod.server;
if (!handler || typeof handler.fetch !== "function") {
  console.error("[server-runner] entry has no fetch handler:", entry);
  process.exit(1);
}

const staticRoot = path.resolve(path.dirname(entry), "..", "client");
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function toWebRequest(req) {
  const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v != null) headers.set(k, String(v));
  }
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: "half",
  });
}

function sendStaticFile(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", `http://${host}:${port}`).pathname);
  } catch {
    return false;
  }
  if (pathname === "/") return false;

  const filePath = path.resolve(staticRoot, pathname.slice(1));
  if (filePath !== staticRoot && !filePath.startsWith(staticRoot + path.sep)) {
    return false;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("content-type", mimeTypes.get(ext) ?? "application/octet-stream");
  if (pathname.startsWith("/assets/")) {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("cache-control", "no-cache");
  }
  if (method === "HEAD") {
    res.end();
  } else {
    fs.createReadStream(filePath).pipe(res);
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (sendStaticFile(req, res)) return;

    const webRes = await handler.fetch(toWebRequest(req));
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-encoding") return;
      res.setHeader(key, value);
    });
    if (webRes.body) {
      Readable.fromWeb(webRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("[server-runner] request error:", err);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`[server-runner] listening on http://${host}:${port}`);
});
