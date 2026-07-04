import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installManagedStatusLine, STATUSLINE_TAP_SCRIPT } from "../statusline-tap";

let tmpDir: string;
let cwd: string;
let home: string;
let tapPath: string;

function settingsFile(): string {
  return path.join(cwd, ".claude", "settings.local.json");
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
}

function writeUserSettings(body: unknown): void {
  const dir = path.join(home, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(body), "utf8");
}

describe("statusline tap installer", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tap-"));
    cwd = path.join(tmpDir, "project");
    home = path.join(tmpDir, "home");
    tapPath = path.join(home, ".claude", "mission-control", "statusline-tap.sh");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs a managed statusLine pointing at the tap", () => {
    installManagedStatusLine(cwd, "darwin", home, tapPath);

    const settings = readSettings();
    expect(settings.statusLine).toEqual({ type: "command", command: tapPath });
  });

  it("mirrors the user's global padding and refreshInterval", () => {
    writeUserSettings({
      statusLine: { type: "command", command: "ccstatusline", padding: 0, refreshInterval: 10 },
    });

    installManagedStatusLine(cwd, "darwin", home, tapPath);

    expect(readSettings().statusLine).toEqual({
      type: "command",
      command: tapPath,
      padding: 0,
      refreshInterval: 10,
    });
  });

  it("preserves unrelated keys and existing hooks in settings.local.json", () => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ hooks: { Stop: [{ hooks: [], _mcManaged: true }] }, custom: 1 }),
      "utf8",
    );

    installManagedStatusLine(cwd, "darwin", home, tapPath);

    const settings = readSettings();
    expect(settings.custom).toBe(1);
    expect(settings.hooks).toBeDefined();
    expect((settings.statusLine as { command: string }).command).toBe(tapPath);
  });

  it("leaves a user-authored project statusLine untouched", () => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ statusLine: { type: "command", command: "my-own-statusline" } }),
      "utf8",
    );

    installManagedStatusLine(cwd, "darwin", home, tapPath);

    expect((readSettings().statusLine as { command: string }).command).toBe("my-own-statusline");
  });

  it("refreshes an entry that already points at the tap (idempotent)", () => {
    installManagedStatusLine(cwd, "darwin", home, tapPath);
    writeUserSettings({ statusLine: { type: "command", command: "ccstatusline", padding: 1 } });

    installManagedStatusLine(cwd, "darwin", home, tapPath);

    expect(readSettings().statusLine).toEqual({ type: "command", command: tapPath, padding: 1 });
  });

  it("does not clobber a settings file that fails to parse", () => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), "{ not json", "utf8");

    installManagedStatusLine(cwd, "darwin", home, tapPath);

    expect(fs.readFileSync(settingsFile(), "utf8")).toBe("{ not json");
  });

  it("is a no-op on windows", () => {
    installManagedStatusLine(cwd, "win32", home, tapPath);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it("tees rate_limits into the shared cache and chains the user's statusline", () => {
    if (process.platform === "win32") return;
    if (spawnSync("python3", ["--version"]).status !== 0) return; // env without python3

    const script = path.join(tmpDir, "statusline-tap.sh");
    fs.writeFileSync(script, STATUSLINE_TAP_SCRIPT, { mode: 0o755 });
    writeUserSettings({
      statusLine: { type: "command", command: "cat >/dev/null; printf OK" },
    });
    const payload = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 19, resets_at: 1783158000 },
        seven_day: { used_percentage: 37.5, resets_at: 1783512000 },
      },
    });

    const res = spawnSync("sh", [script], {
      input: payload,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toBe("OK");
    const cache = JSON.parse(
      fs.readFileSync(path.join(home, ".cache", "claude-limits", "limits.json"), "utf8"),
    );
    expect(cache.five_hour).toMatchObject({ utilization: 19 });
    expect(cache.five_hour.resets_at).toMatch(/^2026-/);
    expect(cache.seven_day.utilization).toBe(37.5);
    expect(cache.source).toBe("statusline");
  });

  it("tap script chains the user statusline and never uses ${...} interpolation pitfalls", () => {
    // Guard the embedded script against accidental template-literal edits:
    // it must stay pure POSIX sh + python with no TS interpolation leftovers.
    expect(STATUSLINE_TAP_SCRIPT).toContain("#!/bin/sh");
    expect(STATUSLINE_TAP_SCRIPT).toContain("rate_limits");
    expect(STATUSLINE_TAP_SCRIPT).toContain("claude-limits");
    expect(STATUSLINE_TAP_SCRIPT).not.toContain("undefined");
  });
});
