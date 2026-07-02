import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as http from "node:http";
import {
  disposeAllPreviewServers,
  isLoopbackHost,
  startPreviewServer,
  urlPathToRel,
} from "../preview-server";

// Issues a raw GET with a caller-controlled Host header (global fetch forbids
// overriding Host), so we can prove the DNS-rebinding guard rejects non-loopback.
function rawGet(
  port: number,
  urlPath: string,
  host: string,
): Promise<{ status: number; body: string; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers: { Host: host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            contentType: res.headers["content-type"] as string | undefined,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("isLoopbackHost", () => {
  it("accepts loopback hosts with or without a port", () => {
    expect(isLoopbackHost("127.0.0.1:5173")).toBe(true);
    expect(isLoopbackHost("localhost:5173")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("LOCALHOST:80")).toBe(true);
    expect(isLoopbackHost("[::1]:5173")).toBe(true);
  });

  it("rejects non-loopback and missing hosts (DNS-rebinding defense)", () => {
    expect(isLoopbackHost("evil.example.com")).toBe(false);
    expect(isLoopbackHost("evil.example.com:5173")).toBe(false);
    expect(isLoopbackHost("192.168.1.10:5173")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});

describe("urlPathToRel", () => {
  const root = path.resolve("/tmp/project");

  it("resolves in-root paths to a normalized relative path", () => {
    expect(urlPathToRel(root, "/index.html")).toBe("index.html");
    expect(urlPathToRel(root, "/assets/app.js")).toBe(path.join("assets", "app.js"));
    expect(urlPathToRel(root, "/")).toBe("");
    expect(urlPathToRel(root, "/src/./nested/../index.html")).toBe(path.join("src", "index.html"));
  });

  it("rejects traversal, absolute escapes, and null bytes", () => {
    expect(urlPathToRel(root, "/../secret.txt")).toBeNull();
    expect(urlPathToRel(root, "/../../etc/passwd")).toBeNull();
    expect(urlPathToRel(root, "/assets/../../etc/passwd")).toBeNull();
    expect(urlPathToRel(root, "/%00/etc/passwd")).toBeNull();
    expect(urlPathToRel(root, "/foo%2f..%2f..%2fetc")).toBeNull();
  });
});

describe("startPreviewServer (integration)", () => {
  let dir = "";
  let outsideDir = "";
  let port = 0;
  let symlinkCreated = false;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-preview-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-secret-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><h1>Hello</h1>");
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "app.css"), "h1{color:red}");
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "TOP SECRET");
    try {
      fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(dir, "escape.html"));
      symlinkCreated = true;
    } catch {
      symlinkCreated = false; // platform without symlink perms — skip that assertion
    }
    const r = await startPreviewServer(dir);
    if (!r.ok) throw new Error(`server failed to start: ${r.error}`);
    port = r.port;
  });

  afterAll(() => {
    disposeAllPreviewServers();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("serves the html document with the right content-type", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("<h1>Hello</h1>");
  });

  it("resolves a root-absolute nested asset (so relative/absolute refs work)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/assets/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(await res.text()).toBe("h1{color:red}");
  });

  it("serves index.html for a directory request", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Hello");
  });

  it("reuses the same server (and port) for the same root", async () => {
    const again = await startPreviewServer(dir);
    expect(again).toEqual({ ok: true, port });
  });

  it("blocks path traversal out of the root", async () => {
    // Bypass fetch's URL normalization with a raw request line.
    const res = await rawGet(port, "/../../secret.txt", `127.0.0.1:${port}`);
    expect(res.status).toBe(404);
  });

  it("rejects a non-loopback Host header (DNS-rebinding defense)", async () => {
    const res = await rawGet(port, "/index.html", "evil.example.com");
    expect(res.status).toBe(403);
  });

  it("does not follow a symlink that escapes the root", async () => {
    if (!symlinkCreated) return;
    const res = await fetch(`http://127.0.0.1:${port}/escape.html`);
    expect(res.status).toBe(404);
  });

  it("returns 405 for non-GET/HEAD methods", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/index.html`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
