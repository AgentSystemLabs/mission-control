import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveAgentCommandOnPath } from "../agent-cli-resolution";

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", "utf8");
}

function writeExecutable(file: string) {
  touch(file);
  fs.chmodSync(file, 0o755);
}

describe("resolveAgentCommandOnPath", () => {
  it("resolves Cursor CLI via the official agent binary name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-alias-"));
    const binDir = path.join(root, "User", ".local", "bin");
    touch(path.join(binDir, "agent.exe"));

    const env = {
      Path: binDir,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };

    expect(resolveAgentCommandOnPath("cursor-agent", env, "win32")).toBe(
      path.join(binDir, "agent.exe"),
    );
    expect(resolveAgentCommandOnPath("cursor-agent", env, "win32")).toBe(
      resolveAgentCommandOnPath("agent", env, "win32"),
    );
  });

  it("prefers Windows command shims over extensionless npm shell shims", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-npm-shim-"));
    const binDir = path.join(root, "npm");
    touch(path.join(binDir, "codex"));
    touch(path.join(binDir, "codex.cmd"));

    const env = {
      Path: binDir,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };

    expect(resolveAgentCommandOnPath("codex", env, "win32")).toBe(
      path.join(binDir, "codex.cmd"),
    );
  });

  it("prefers cursor-agent when both shims exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cursor-both-"));
    const binDir = path.join(root, "bin");
    writeExecutable(path.join(binDir, "cursor-agent"));
    writeExecutable(path.join(binDir, "agent"));

    const env = { PATH: binDir };

    expect(resolveAgentCommandOnPath("cursor-agent", env, "darwin")).toBe(
      path.join(binDir, "cursor-agent"),
    );
  });
});
