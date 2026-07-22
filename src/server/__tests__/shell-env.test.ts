import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildUserPath,
  parseShellEnvOutput,
  resolveAllCommandsOnPath,
  resolveCommandOnPath,
  setCanonicalPathEnv,
  shellArgsForCommand,
} from "../../../electron/shell-env";

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", "utf8");
}

function touchExecutable(file: string) {
  touch(file);
  fs.chmodSync(file, 0o755);
}

describe("Electron shell environment helpers", () => {
  it("parses shell-captured env between markers and ignores startup output", () => {
    const parsed = parseShellEnvOutput(
      [
        "startup banner",
        "__MISSION_CONTROL_ENV_START__",
        "PATH=/from/shell/bin:/usr/bin",
        "DOCKER_HOST=unix:///Users/me/.docker/run/docker.sock",
        "invalid-key=value",
        "__MISSION_CONTROL_ENV_END__",
        "prompt noise",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      PATH: "/from/shell/bin:/usr/bin",
      DOCKER_HOST: "unix:///Users/me/.docker/run/docker.sock",
    });
  });

  it("adds common Windows agent CLI install directories before the packaged app PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-win-path-"));
    const home = path.join(root, "User");
    const appData = path.join(root, "AppData", "Roaming");
    const localAppData = path.join(root, "AppData", "Local");
    const systemRoot = path.join(root, "Windows");
    const packagedPath = path.join(root, "MissionControl");
    const voltaHome = path.join(root, "Volta");
    const pnpmHome = path.join(root, "PnpmHome");
    const userDockerBin = path.join(home, ".docker", "bin");
    const dockerDesktopBin = path.join(root, "Program Files", "Docker", "Docker", "resources", "bin");
    const nvmHome = path.join(root, "nvm");
    const nvmSymlink = path.join(root, "nodejs");
    const codexBin = path.join(localAppData, "OpenAI", "Codex", "bin");
    const codexPackageBin = path.join(
      localAppData,
      "Packages",
      "OpenAI.Codex_test",
      "LocalCache",
      "Local",
      "OpenAI",
      "Codex",
      "bin"
    );

    for (const dir of [
      path.join(home, ".local", "bin"),
      path.join(appData, "npm"),
      path.join(appData, ".npm-global", "bin"),
      path.join(voltaHome, "bin"),
      pnpmHome,
      userDockerBin,
      dockerDesktopBin,
      codexBin,
      codexPackageBin,
      path.join(nvmHome, "v24.0.0"),
      nvmSymlink,
      path.join(localAppData, "Microsoft", "WindowsApps"),
      path.join(localAppData, "Programs", "Cursor", "resources", "app", "bin"),
      path.join(systemRoot, "System32"),
      packagedPath,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const resolvedPath = buildUserPath(packagedPath, {
      platform: "win32",
      homeDir: home,
      env: {
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        VOLTA_HOME: voltaHome,
        PNPM_HOME: pnpmHome,
        NVM_HOME: nvmHome,
        NVM_SYMLINK: nvmSymlink,
        SystemRoot: systemRoot,
        ProgramFiles: path.join(root, "Program Files"),
      },
    });

    const entries = resolvedPath.split(";");
    expect(entries).toContain(path.join(home, ".local", "bin"));
    expect(entries).toContain(path.join(appData, "npm"));
    expect(entries).toContain(path.join(appData, ".npm-global", "bin"));
    expect(entries).toContain(path.join(voltaHome, "bin"));
    expect(entries).toContain(pnpmHome);
    expect(entries).toContain(userDockerBin);
    expect(entries).toContain(dockerDesktopBin);
    expect(entries).toContain(codexBin);
    expect(entries).toContain(codexPackageBin);
    expect(entries).toContain(path.join(nvmHome, "v24.0.0"));
    expect(entries).toContain(nvmSymlink);
    expect(entries).toContain(path.join(localAppData, "Microsoft", "WindowsApps"));
    expect(entries).toContain(
      path.join(localAppData, "Programs", "Cursor", "resources", "app", "bin")
    );
    expect(entries.indexOf(path.join(appData, "npm"))).toBeLessThan(entries.indexOf(packagedPath));
  });

  it("adds Laravel Herd nvm bin directories on macOS", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-herd-path-"));
    const home = path.join(root, "home");
    const herdBin = path.join(
      home,
      "Library",
      "Application Support",
      "Herd",
      "config",
      "nvm",
      "versions",
      "node",
      "v24.15.0",
      "bin",
    );
    const olderHerdBin = path.join(
      home,
      "Library",
      "Application Support",
      "Herd",
      "config",
      "nvm",
      "versions",
      "node",
      "v22.22.2",
      "bin",
    );

    fs.mkdirSync(olderHerdBin, { recursive: true });
    fs.mkdirSync(herdBin, { recursive: true });

    const entries = buildUserPath("", {
      platform: "darwin",
      homeDir: home,
      pathExists: (entry) => fs.existsSync(entry) || entry === "/opt/homebrew/bin",
    }).split(path.delimiter);

    expect(entries).toContain(herdBin);
    expect(entries).toContain(olderHerdBin);
    expect(entries.indexOf(herdBin)).toBeLessThan(entries.indexOf(olderHerdBin));
    expect(entries.indexOf(herdBin)).toBeLessThan(entries.indexOf("/opt/homebrew/bin"));
  });

  it("adds POSIX Node manager and package-manager bin directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-posix-path-"));
    const home = path.join(root, "home");
    const nvmDir = path.join(home, ".nvm");
    const fnmDir = path.join(home, ".fnm");

    for (const dir of [
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".local", "share", "pnpm"),
      path.join(home, ".yarn", "bin"),
      path.join(home, ".config", "yarn", "global", "node_modules", ".bin"),
      path.join(nvmDir, "versions", "node", "v24.0.0", "bin"),
      path.join(fnmDir, "node-versions", "v24.0.0", "installation", "bin"),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entries = buildUserPath("", {
      platform: "darwin",
      homeDir: home,
      env: { NVM_DIR: nvmDir, FNM_DIR: fnmDir },
    }).split(path.delimiter);

    expect(entries).toContain(path.join(home, ".npm-global", "bin"));
    expect(entries).toContain(path.join(home, ".volta", "bin"));
    expect(entries).toContain(path.join(home, ".local", "share", "pnpm"));
    expect(entries).toContain(path.join(home, ".yarn", "bin"));
    expect(entries).toContain(path.join(home, ".config", "yarn", "global", "node_modules", ".bin"));
    expect(entries).toContain(path.join(nvmDir, "versions", "node", "v24.0.0", "bin"));
    expect(entries).toContain(path.join(fnmDir, "node-versions", "v24.0.0", "installation", "bin"));
  });

  it("adds POSIX Docker Desktop CLI directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-posix-docker-path-"));
    const home = path.join(root, "home");
    const userDockerBin = path.join(home, ".docker", "bin");
    const dockerDesktopBin = "/Applications/Docker.app/Contents/Resources/bin";

    fs.mkdirSync(userDockerBin, { recursive: true });

    const entries = buildUserPath("", {
      platform: "darwin",
      homeDir: home,
      pathExists: (entry) => entry === userDockerBin || entry === dockerDesktopBin,
    }).split(path.delimiter);

    expect(entries).toContain(userDockerBin);
    expect(entries).toContain(dockerDesktopBin);
  });

  it("adds POSIX Codex app CLI resource directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-posix-codex-path-"));
    const home = path.join(root, "home");
    const userCodexResources = path.join(home, "Applications", "Codex.app", "Contents", "Resources");
    const systemCodexResources = "/Applications/Codex.app/Contents/Resources";

    fs.mkdirSync(userCodexResources, { recursive: true });

    const entries = buildUserPath("", {
      platform: "darwin",
      homeDir: home,
      pathExists: (entry) => entry === userCodexResources || entry === systemCodexResources,
    }).split(path.delimiter);

    expect(entries).toContain(systemCodexResources);
    expect(entries).toContain(userCodexResources);
  });

  it("preserves POSIX base PATH order before guessed Node-manager versions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-posix-path-order-"));
    const home = path.join(root, "home");
    const nvmDir = path.join(home, ".nvm");
    const activeBin = path.join(nvmDir, "versions", "node", "v24.15.0", "bin");
    const staleBin = path.join(nvmDir, "versions", "node", "v22.21.1", "bin");

    fs.mkdirSync(activeBin, { recursive: true });
    fs.mkdirSync(staleBin, { recursive: true });

    const entries = buildUserPath(activeBin, {
      platform: "darwin",
      homeDir: home,
      env: { NVM_DIR: nvmDir },
    }).split(path.delimiter);

    expect(entries[0]).toBe(activeBin);
    expect(entries.indexOf(activeBin)).toBeLessThan(entries.indexOf(staleBin));
  });

  it("orders guessed POSIX Node-manager versions newest first when PATH has no active version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-posix-version-order-"));
    const home = path.join(root, "home");
    const nvmDir = path.join(home, ".nvm");
    const newestBin = path.join(nvmDir, "versions", "node", "v24.15.0", "bin");
    const olderBin = path.join(nvmDir, "versions", "node", "v22.21.1", "bin");

    fs.mkdirSync(olderBin, { recursive: true });
    fs.mkdirSync(newestBin, { recursive: true });

    const entries = buildUserPath("", {
      platform: "darwin",
      homeDir: home,
      env: { NVM_DIR: nvmDir },
    }).split(path.delimiter);

    expect(entries.indexOf(newestBin)).toBeLessThan(entries.indexOf(olderBin));
  });

  it("resolves POSIX executables from active PATH entries that contain spaces", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-posix-space-path-"));
    const home = path.join(root, "home");
    const herdNvmDir = path.join(home, "Library", "Application Support", "Herd", "config", "nvm");
    const activeBin = path.join(herdNvmDir, "versions", "node", "v24.15.0", "bin");
    const codexPath = path.join(activeBin, "codex");

    touchExecutable(codexPath);

    const pathValue = buildUserPath(activeBin, {
      platform: "darwin",
      homeDir: home,
      env: { NVM_DIR: herdNvmDir },
    });

    expect(resolveCommandOnPath("codex", { PATH: pathValue }, "darwin")).toBe(codexPath);
  });

  it("lists every PATH match for a command in order", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-all-commands-"));
    const firstDir = path.join(root, "first");
    const secondDir = path.join(root, "second");
    const first = path.join(firstDir, "codex");
    const second = path.join(secondDir, "codex");

    touchExecutable(first);
    touchExecutable(second);

    expect(
      resolveAllCommandsOnPath("codex", { PATH: `${firstDir}${path.delimiter}${secondDir}` }, "darwin"),
    ).toEqual([first, second]);
  });

  it("adds agent-specific home bin directories from CLI config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-path-"));
    const home = path.join(root, "home");
    const opencodeBin = path.join(home, ".opencode", "bin");

    fs.mkdirSync(opencodeBin, { recursive: true });

    const entries = buildUserPath("", {
      platform: "win32",
      homeDir: home,
      pathExists: (entry) => entry === opencodeBin,
    }).split(";");

    expect(entries).toContain(opencodeBin);
  });

  it("resolves Windows .exe and .cmd agent shims without spawning PowerShell", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-win-cli-"));
    const nativeBin = path.join(root, "User", ".local", "bin");
    const npmBin = path.join(root, "AppData", "Roaming", "npm");

    touch(path.join(nativeBin, "claude.exe"));
    touch(path.join(npmBin, "codex.cmd"));

    const env = {
      PATH: [nativeBin, npmBin].join(";"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };

    expect(resolveCommandOnPath("claude", env, "win32")).toBe(path.join(nativeBin, "claude.exe"));
    expect(resolveCommandOnPath("codex", env, "win32")).toBe(path.join(npmBin, "codex.cmd"));
  });

  it("resolves Windows commands from canonical Path casing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-win-cli-path-case-"));
    const nativeBin = path.join(root, "User", ".local", "bin");
    const npmBin = path.join(root, "AppData", "Roaming", "npm");

    touch(path.join(nativeBin, "claude.exe"));
    touch(path.join(npmBin, "codex.cmd"));

    const env = {
      Path: [nativeBin, npmBin].join(";"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };

    expect(resolveCommandOnPath("claude", env, "win32")).toBe(path.join(nativeBin, "claude.exe"));
    expect(resolveCommandOnPath("codex", env, "win32")).toBe(path.join(npmBin, "codex.cmd"));
  });

  it("canonicalizes Windows PATH casing before passing env to child shells", () => {
    const env = {
      PATH: "C:\\PackagedApp",
      Path: "C:\\Windows\\System32",
      path: "C:\\Ignored",
    };

    setCanonicalPathEnv(env, "C:\\Users\\me\\.local\\bin;C:\\Windows\\System32", "win32");

    expect(env).toEqual({
      Path: "C:\\Users\\me\\.local\\bin;C:\\Windows\\System32",
    });
  });

  it("uses PowerShell-compatible arguments on Windows instead of POSIX login-shell flags", () => {
    expect(shellArgsForCommand("powershell.exe", "claude", "win32")).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "claude",
    ]);
    expect(shellArgsForCommand("powershell.exe", undefined, "win32")).toEqual(["-NoLogo"]);
  });

  it("uses interactive login shell execution for POSIX launch commands", () => {
    expect(shellArgsForCommand("/bin/zsh", "codex --enable hooks", "darwin")).toEqual([
      "-l",
      "-i",
      "-c",
      "codex --enable hooks",
    ]);
  });
});
