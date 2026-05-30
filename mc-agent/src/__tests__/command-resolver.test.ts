import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandOnPath } from "../command-resolver";

let binDir: string;
let exe: string;

beforeAll(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bin-"));
  exe = path.join(binDir, "fakecli");
  fs.writeFileSync(exe, "#!/bin/sh\necho hi\n");
  fs.chmodSync(exe, 0o755);
  // a non-executable file that must NOT resolve
  fs.writeFileSync(path.join(binDir, "notexec"), "data");
});

afterAll(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe("resolveCommandOnPath", () => {
  it("finds an executable on PATH", () => {
    expect(resolveCommandOnPath("fakecli", { PATH: binDir })).toBe(exe);
  });

  it("returns null for a missing command", () => {
    expect(resolveCommandOnPath("does-not-exist", { PATH: binDir })).toBeNull();
  });

  it("ignores non-executable files", () => {
    expect(resolveCommandOnPath("notexec", { PATH: binDir })).toBeNull();
  });

  it("resolves an absolute executable path directly", () => {
    expect(resolveCommandOnPath(exe, { PATH: "" })).toBe(exe);
  });

  it("returns null for an absolute path that is not executable", () => {
    expect(resolveCommandOnPath(path.join(binDir, "notexec"), { PATH: "" })).toBeNull();
  });
});
