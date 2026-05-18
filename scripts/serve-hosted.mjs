import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

const root = resolve(import.meta.dirname, "..");
const clientDir = resolve(root, "dist-server/client");
const serverEntry = resolve(root, "dist-server/server/server.js");

if (!existsSync(clientDir) || !existsSync(serverEntry)) {
  console.error("Missing hosted build output. Run `pnpm build:web` before `pnpm start:hosted`.");
  process.exit(1);
}

const { default: handler } = await import(serverEntry);
if (!handler?.fetch) {
  console.error("Hosted server entry does not export a fetch handler.");
  process.exit(1);
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function staticPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const rel = normalize(pathname.replace(/^\/+/, ""));
  if (!rel || rel.startsWith("..") || rel.includes(`${sep}..${sep}`)) return null;
  const file = join(clientDir, rel);
  return file.startsWith(clientDir) ? file : null;
}

function sendStatic(req, res) {
  const file = staticPath(req.url ?? "/");
  if (!file || !existsSync(file)) return false;
  const stat = statSync(file);
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    "content-length": stat.size,
    "content-type": contentTypes.get(extname(file)) || "application/octet-stream",
  });
  createReadStream(file).pipe(res);
  return true;
}

function requestUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  return `${proto}://${hostHeader}${req.url || "/"}`;
}

function toWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(requestUrl(req), {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
}

async function sendWebResponse(webResponse, res) {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  const setCookies = getSetCookieHeaders(webResponse.headers);
  if (setCookies.length) res.setHeader("set-cookie", setCookies);
  if (!webResponse.body) {
    res.end();
    return;
  }
  Readable.fromWeb(webResponse.body).pipe(res);
}

function getSetCookieHeaders(headers) {
  const values = headers.getSetCookie?.();
  if (values?.length) return values;
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      if (sendStatic(req, res)) return;
    }
    await sendWebResponse(await handler.fetch(toWebRequest(req)), res);
  } catch (err) {
    console.error("[hosted] request failed", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(port, host, () => {
  console.log(`Mission Control hosted server listening on http://${host}:${port}`);
});
