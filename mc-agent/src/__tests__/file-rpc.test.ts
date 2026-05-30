import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileRpc } from "../file-rpc";

let workspace: string;
let rpc: FileRpc;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mc-frpc-"));
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "node_modules", "pkg"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "a.ts"), "line1\nline2\n");
  fs.writeFileSync(path.join(workspace, "node_modules", "pkg", "index.js"), "x");
  fs.writeFileSync(path.join(workspace, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(workspace, "ignored.txt"), "secret");
  rpc = new FileRpc(workspace, vi.fn());
});

afterEach(() => {
  rpc.closeAll();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("FileRpc.list", () => {
  it("lists files, skipping node_modules/.git and .gitignore entries", () => {
    const r = rpc.list({ path: workspace });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files).toContain("src/a.ts");
    expect(r.files.some((f) => f.startsWith("node_modules"))).toBe(false);
    expect(r.files.some((f) => f.startsWith(".git/"))).toBe(false);
    expect(r.files).not.toContain("ignored.txt");
  });

  it("rejects a path outside the workspace", () => {
    const r = rpc.list({ path: path.join(workspace, "..", "elsewhere") });
    expect(r).toEqual({ ok: false, error: "invalid-path" });
  });
});

describe("FileRpc.read", () => {
  it("reads a text file with line count", () => {
    const r = rpc.read({ path: path.join(workspace, "src", "a.ts") });
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "text") {
      expect(r.content).toBe("line1\nline2\n");
      expect(r.lineCount).toBe(3);
    } else {
      throw new Error("expected text read");
    }
  });

  it("returns not-found for a missing file", () => {
    expect(rpc.read({ path: path.join(workspace, "nope.ts") })).toEqual({
      ok: false,
      error: "not-found",
    });
  });

  it("detects binary files", () => {
    fs.writeFileSync(path.join(workspace, "bin.dat"), Buffer.from([1, 2, 0, 3]));
    expect(rpc.read({ path: path.join(workspace, "bin.dat") })).toEqual({
      ok: false,
      error: "binary",
    });
  });
});

describe("FileRpc.write", () => {
  it("writes a file inside the workspace and returns mtime", () => {
    const target = path.join(workspace, "src", "b.ts");
    const r = rpc.write({ path: target, content: "hello" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("hello");
  });

  it("refuses protected paths (no native dialog in the container)", () => {
    expect(rpc.write({ path: path.join(workspace, ".git", "config"), content: "x" })).toEqual({
      ok: false,
      error: "protected-path",
    });
    expect(rpc.write({ path: path.join(workspace, "package.json"), content: "{}" })).toEqual({
      ok: false,
      error: "protected-path",
    });
    expect(
      rpc.write({ path: path.join(workspace, ".claude", "settings.local.json"), content: "{}" }),
    ).toEqual({ ok: false, error: "protected-path" });
  });

  it("rejects paths outside the workspace", () => {
    expect(rpc.write({ path: path.join(workspace, "..", "evil.txt"), content: "x" })).toEqual({
      ok: false,
      error: "invalid-path",
    });
  });

  it("enforces the optimistic mtime lock", () => {
    const target = path.join(workspace, "src", "a.ts");
    const r = rpc.write({ path: target, content: "new", expectedMtimeMs: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("stale");
  });
});

describe("FileRpc.watch / unwatch", () => {
  it("returns a watchId and unwatches cleanly", () => {
    const w = rpc.watch({ path: path.join(workspace, "src", "a.ts") });
    expect(w.ok).toBe(true);
    if (w.ok) expect(rpc.unwatch({ watchId: w.watchId })).toEqual({ ok: true });
  });
});
