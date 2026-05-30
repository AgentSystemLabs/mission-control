import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveInsideWorkspace, isInsideWorkspace, isSafeSlug } from "../workspace-guard";

let workspace: string;
let outside: string;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ws-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "mc-out-"));
  fs.mkdirSync(path.join(workspace, "proj", "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "proj", "src", "a.ts"), "x");
  fs.writeFileSync(path.join(outside, "secret.txt"), "nope");
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("resolveInsideWorkspace", () => {
  it("resolves a path inside the workspace", () => {
    const abs = resolveInsideWorkspace(workspace, path.join(workspace, "proj", "src", "a.ts"));
    expect(abs).not.toBeNull();
    expect(abs).toBe(fs.realpathSync(path.join(workspace, "proj", "src", "a.ts")));
  });

  it("allows the workspace root itself", () => {
    expect(resolveInsideWorkspace(workspace, workspace)).not.toBeNull();
  });

  it("returns the absolute path for a not-yet-existing target inside the root", () => {
    const target = path.join(workspace, "proj", "new-file.ts");
    expect(resolveInsideWorkspace(workspace, target)).toBe(target);
  });

  it("rejects a NUL byte", () => {
    expect(resolveInsideWorkspace(workspace, "proj/\0a")).toBeNull();
  });

  it("rejects a relative escape", () => {
    expect(resolveInsideWorkspace(workspace, "../../etc/passwd")).toBeNull();
  });

  it("rejects an absolute path outside the workspace", () => {
    expect(resolveInsideWorkspace(workspace, path.join(outside, "secret.txt"))).toBeNull();
  });

  it("rejects a symlink that escapes the workspace", () => {
    const link = path.join(workspace, "escape-link");
    fs.symlinkSync(outside, link);
    expect(resolveInsideWorkspace(workspace, path.join(link, "secret.txt"))).toBeNull();
  });
});

describe("isInsideWorkspace", () => {
  it("is the boolean form of resolveInsideWorkspace", () => {
    expect(isInsideWorkspace(workspace, path.join(workspace, "proj"))).toBe(true);
    expect(isInsideWorkspace(workspace, "../x")).toBe(false);
  });
});

describe("isSafeSlug", () => {
  it("accepts simple single-segment slugs", () => {
    expect(isSafeSlug("acme")).toBe(true);
    expect(isSafeSlug("acme-web_2")).toBe(true);
  });
  it("rejects separators, dotfiles, traversal, and empties", () => {
    expect(isSafeSlug("a/b")).toBe(false);
    expect(isSafeSlug("..")).toBe(false);
    expect(isSafeSlug(".")).toBe(false);
    expect(isSafeSlug("")).toBe(false);
    expect(isSafeSlug("a\\b")).toBe(false);
    expect(isSafeSlug("-startsdash")).toBe(false);
    expect(isSafeSlug("@bad")).toBe(false);
  });
});
