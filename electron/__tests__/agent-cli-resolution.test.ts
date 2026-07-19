import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AGENT_CLI_CONFIG } from "../agent-cli-version-requirements";
import { clearAgentCliVersionCache } from "../agent-cli-version";
import {
  resolveAgentCommandMeetingVersion,
  resolveAgentCommandOnPath,
  resolveAllAgentCommandsOnPath,
} from "../agent-cli-resolution";

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", "utf8");
}

function writeExecutable(file: string, contents = "#!/bin/sh\n") {
  touch(file);
  fs.writeFileSync(file, contents, "utf8");
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

describe("resolveAgentCommandMeetingVersion", () => {
  it("skips an outdated early PATH match in favor of a newer later install", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-codex-multi-"));
    const staleDir = path.join(root, "homebrew", "bin");
    const freshDir = path.join(root, "herd", "bin");
    const stale = path.join(staleDir, "codex");
    const fresh = path.join(freshDir, "codex");

    writeExecutable(stale, "#!/bin/sh\necho 'codex-cli 0.131.0'\n");
    writeExecutable(fresh, "#!/bin/sh\necho 'codex-cli 0.144.1'\n");

    const env = { PATH: `${staleDir}${path.delimiter}${freshDir}` };
    clearAgentCliVersionCache();

    expect(resolveAllAgentCommandsOnPath("codex", env, "darwin")).toEqual([stale, fresh]);
    expect(resolveAgentCommandOnPath("codex", env, "darwin")).toBe(stale);

    const meeting = resolveAgentCommandMeetingVersion(
      "codex",
      AGENT_CLI_CONFIG.codex,
      env,
      "darwin",
      { fresh: true },
    );
    expect(meeting?.binary).toBe(fresh);
    expect(meeting?.check.ok).toBe(true);
    if (meeting?.check.ok) expect(meeting.check.version).toBe("0.144.1");
  });

  it("returns the first binary when every PATH match is outdated", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-codex-all-stale-"));
    const firstDir = path.join(root, "a");
    const secondDir = path.join(root, "b");
    const first = path.join(firstDir, "codex");
    const second = path.join(secondDir, "codex");

    writeExecutable(first, "#!/bin/sh\necho 'codex-cli 0.131.0'\n");
    writeExecutable(second, "#!/bin/sh\necho 'codex-cli 0.120.0'\n");

    const env = { PATH: `${firstDir}${path.delimiter}${secondDir}` };
    clearAgentCliVersionCache();

    const meeting = resolveAgentCommandMeetingVersion(
      "codex",
      AGENT_CLI_CONFIG.codex,
      env,
      "darwin",
      { fresh: true },
    );
    expect(meeting?.binary).toBe(first);
    expect(meeting?.check.ok).toBe(false);
    if (meeting && !meeting.check.ok) {
      expect(meeting.check.reason).toBe("outdated");
      expect(meeting.check.version).toBe("0.131.0");
    }
  });
});
