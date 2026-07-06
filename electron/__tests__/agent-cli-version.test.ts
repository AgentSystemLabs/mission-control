import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildCliVersionProbe,
  checkAgentCliVersion,
  checkAgentCliVersionCached,
  clearAgentCliVersionCache,
  compareCliVersions,
  extractCliVersion,
} from "../agent-cli-version";
import {
  AGENT_CLI_CONFIG,
  resolveAgentCliUpdateCommands,
} from "../agent-cli-version-requirements";

describe("agent CLI version helpers", () => {
  it("wraps Windows command shims through cmd.exe with a quoted version command", () => {
    const binary = String.raw`C:\Users\Jane Doe\AppData\Roaming\npm\codex.cmd`;
    const probe = buildCliVersionProbe(
      binary,
      {
        APPDATA: String.raw`C:\Users\Jane Doe\AppData\Roaming`,
        ComSpec: String.raw`C:\Windows\System32\cmd.exe`,
        LOCALAPPDATA: String.raw`C:\Users\Jane Doe\AppData\Local`,
        OPENAI_API_KEY: "secret",
        Path: String.raw`C:\Users\Jane Doe\AppData\Roaming\npm;C:\Windows\System32`,
        SystemRoot: String.raw`C:\Windows`,
        TEMP: String.raw`C:\Users\Jane Doe\AppData\Local\Temp`,
        TMP: String.raw`C:\Users\Jane Doe\AppData\Local\Temp`,
        USERPROFILE: String.raw`C:\Users\Jane Doe`,
      },
      "win32",
    );

    expect(probe.command).toBe(String.raw`C:\Windows\System32\cmd.exe`);
    expect(probe.args).toEqual([
      "/d",
      "/s",
      "/c",
      String.raw`""C:\Users\Jane Doe\AppData\Roaming\npm\codex.cmd" "--version""`,
    ]);
    expect(probe.env.APPDATA).toBe(String.raw`C:\Users\Jane Doe\AppData\Roaming`);
    expect(probe.env.LOCALAPPDATA).toBe(String.raw`C:\Users\Jane Doe\AppData\Local`);
    expect(probe.env.USERPROFILE).toBe(String.raw`C:\Users\Jane Doe`);
    expect(probe.env.OPENAI_API_KEY).toBeUndefined();
  });

  if (process.platform === "win32") {
    it("executes Windows command shims with verbatim cmd.exe arguments", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-version-shim-"));
      const binDir = path.join(root, "npm shims");
      fs.mkdirSync(binDir, { recursive: true });
      const binary = path.join(binDir, "codex.cmd");
      fs.writeFileSync(binary, "@ECHO off\r\necho codex-cli 0.133.0\r\n", "utf8");

      const result = checkAgentCliVersion(
        binary,
        {
          Path: process.env.Path ?? "",
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          WINDIR: process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows",
        },
        AGENT_CLI_CONFIG.codex,
        "win32",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("version check failed");
      expect(result.version).toBe("0.133.0");
    });
  }

  it("keeps native CLI version probes as direct argv without secret env vars", () => {
    const probe = buildCliVersionProbe(
      "/usr/local/bin/claude",
      {
        ANTHROPIC_API_KEY: "secret",
        HOME: "/Users/jane",
        PATH: "/usr/local/bin:/usr/bin",
      },
      "darwin",
    );

    expect(probe.command).toBe("/usr/local/bin/claude");
    expect(probe.args).toEqual(["--version"]);
    expect(probe.env.HOME).toBe("/Users/jane");
    expect(probe.env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(probe.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("extracts versions from supported CLI outputs", () => {
    expect(extractCliVersion("codex 0.132.0")).toBe("0.132.0");
    expect(extractCliVersion("OpenAI Codex v0.132.0-alpha.1")).toBe("0.132.0-alpha.1");
    expect(extractCliVersion("2.1.146 (Claude Code)")).toBe("2.1.146");
    expect(extractCliVersion("2026.05.20-2b5dd59")).toBe("2026.05.20-2b5dd59");
  });

  it("compares semantic versions against configured minimums", () => {
    expect(compareCliVersions("0.131.9", AGENT_CLI_CONFIG.codex.minimumVersion, "semver")).toBeLessThan(0);
    expect(compareCliVersions("0.132.0", AGENT_CLI_CONFIG.codex.minimumVersion, "semver")).toBe(0);
    expect(compareCliVersions("2.1.145", AGENT_CLI_CONFIG["claude-code"].minimumVersion, "semver")).toBeLessThan(0);
    expect(compareCliVersions("2.1.146", AGENT_CLI_CONFIG["claude-code"].minimumVersion, "semver")).toBe(0);
  });

  it("compares Cursor calendar versions by date because the build hash is not orderable", () => {
    const cursorRequirement = AGENT_CLI_CONFIG["cursor-cli"];

    expect(compareCliVersions("2026.05.19-abcdef0", cursorRequirement.minimumVersion, cursorRequirement.versionScheme)).toBeLessThan(0);
    expect(compareCliVersions("2026.05.20-abcdef0", cursorRequirement.minimumVersion, cursorRequirement.versionScheme)).toBe(0);
    expect(compareCliVersions("2026.05.21-0000000", cursorRequirement.minimumVersion, cursorRequirement.versionScheme)).toBeGreaterThan(0);
  });

  it("returns platform-specific Cursor install commands", () => {
    const cursorRequirement = AGENT_CLI_CONFIG["cursor-cli"];

    expect(resolveAgentCliUpdateCommands(cursorRequirement.updateCommands, "win32")).toEqual([
      "irm 'https://cursor.com/install?win32=true' | iex",
      "agent update",
    ]);
    expect(resolveAgentCliUpdateCommands(cursorRequirement.updateCommands, "darwin")).toEqual([
      "curl https://cursor.com/install -fsS | bash",
      "agent update",
    ]);
  });

  it("filters brew-only Codex update commands on Windows", () => {
    const codexRequirement = AGENT_CLI_CONFIG.codex;

    expect(resolveAgentCliUpdateCommands(codexRequirement.updateCommands, "win32")).toEqual([
      "npm install -g @openai/codex@latest",
    ]);
    expect(resolveAgentCliUpdateCommands(codexRequirement.updateCommands, "darwin")).toEqual([
      "npm install -g @openai/codex@latest",
      "brew upgrade codex",
    ]);
  });

  if (os.platform() !== "win32") {
    it("caches a passing version probe so repeat spawns skip the CLI launch", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-version-cache-"));
      try {
        const counter = path.join(root, "count");
        const binary = path.join(root, "claude");
        fs.writeFileSync(
          binary,
          `#!/bin/sh\necho probe >> "${counter}"\necho "${AGENT_CLI_CONFIG["claude-code"].minimumVersion} (Claude Code)"\n`,
          { mode: 0o755 },
        );

        clearAgentCliVersionCache();
        const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
        const first = checkAgentCliVersionCached(
          binary,
          env,
          AGENT_CLI_CONFIG["claude-code"],
          "darwin",
        );
        const second = checkAgentCliVersionCached(
          binary,
          env,
          AGENT_CLI_CONFIG["claude-code"],
          "darwin",
        );

        expect(first.ok).toBe(true);
        expect(second).toBe(first);
        const probes = fs.readFileSync(counter, "utf8").trim().split("\n");
        expect(probes).toHaveLength(1);
      } finally {
        clearAgentCliVersionCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
