import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildCliSpawnInvocation } from "../claude-cli";
import { detectInstalledCommitClisFromEnv } from "../commit-cli";

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", "utf8");
}

function writeExecutable(file: string) {
  touch(file);
  fs.chmodSync(file, 0o755);
}

describe("commit CLI detection", () => {
  it("uses the session CLI resolver for Windows shims and aliases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-commit-cli-"));
    const binDir = path.join(root, "npm shims");
    touch(path.join(binDir, "claude.exe"));
    touch(path.join(binDir, "codex.cmd"));
    touch(path.join(binDir, "agent.exe"));
    touch(path.join(binDir, "opencode.cmd"));

    const detected = detectInstalledCommitClisFromEnv(
      {
        Path: binDir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      },
      "win32",
    );

    expect(detected).toEqual({
      claude: true,
      codex: true,
      "cursor-agent": true,
      opencode: true,
    });
  });
});

describe("print-mode CLI spawning", () => {
  it("launches Windows npm shims through their JS entrypoint", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-commit-spawn-"));
    const binDir = path.join(root, "npm shims");
    const script = path.join(binDir, "node_modules", "@openai", "codex", "bin", "codex.js");
    const node = path.join(binDir, "node.exe");
    const codex = path.join(binDir, "codex.cmd");
    touch(script);
    touch(node);
    touch(codex);
    fs.writeFileSync(
      codex,
      '@ECHO off\r\n"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      "utf8",
    );

    const invocation = buildCliSpawnInvocation(
      "codex",
      ["exec", "literal %SECRET% prompt\nwith newline"],
      {
        Path: binDir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      },
      "win32",
    );

    expect(invocation.command).toBe(node);
    expect(invocation.args).toEqual([
      script,
      "exec",
      "literal %SECRET% prompt\nwith newline",
    ]);
  });

  it("spawns resolved native binaries directly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-commit-native-"));
    const binDir = path.join(root, "bin");
    const claude = path.join(binDir, "claude");
    writeExecutable(claude);

    const invocation = buildCliSpawnInvocation(
      "claude",
      ["-p", "hello"],
      { PATH: binDir },
      "darwin",
    );

    expect(invocation.command).toBe(claude);
    expect(invocation.args).toEqual(["-p", "hello"]);
  });

  it("rejects unrecognized Windows command shims instead of shelling user prompts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-commit-unsafe-shim-"));
    const binDir = path.join(root, "npm shims");
    const codex = path.join(binDir, "codex.cmd");
    touch(codex);
    fs.writeFileSync(codex, "@ECHO off\r\necho unsupported %*\r\n", "utf8");

    expect(() =>
      buildCliSpawnInvocation(
        "codex",
        ["exec", "%SECRET%"],
        {
          Path: binDir,
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
        },
        "win32",
      )
    ).toThrow("cannot safely launch Windows command shim");
  });
});
