import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildUserPath,
  resolveCommandOnPath,
  shellArgsForCommand,
} from "../../../electron/shell-env";

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", "utf8");
}

describe("Electron shell environment helpers", () => {
  it("adds common Windows agent CLI install directories before the packaged app PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-win-path-"));
    const home = path.join(root, "User");
    const appData = path.join(root, "AppData", "Roaming");
    const localAppData = path.join(root, "AppData", "Local");
    const systemRoot = path.join(root, "Windows");
    const packagedPath = path.join(root, "MissionControl");
    const voltaHome = path.join(root, "Volta");
    const pnpmHome = path.join(root, "PnpmHome");
    const nvmHome = path.join(root, "nvm");
    const nvmSymlink = path.join(root, "nodejs");

    for (const dir of [
      path.join(home, ".local", "bin"),
      path.join(appData, "npm"),
      path.join(appData, ".npm-global", "bin"),
      path.join(voltaHome, "bin"),
      pnpmHome,
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
      },
    });

    const entries = resolvedPath.split(";");
    expect(entries).toContain(path.join(home, ".local", "bin"));
    expect(entries).toContain(path.join(appData, "npm"));
    expect(entries).toContain(path.join(appData, ".npm-global", "bin"));
    expect(entries).toContain(path.join(voltaHome, "bin"));
    expect(entries).toContain(pnpmHome);
    expect(entries).toContain(path.join(nvmHome, "v24.0.0"));
    expect(entries).toContain(nvmSymlink);
    expect(entries).toContain(path.join(localAppData, "Microsoft", "WindowsApps"));
    expect(entries).toContain(
      path.join(localAppData, "Programs", "Cursor", "resources", "app", "bin")
    );
    expect(entries.indexOf(path.join(appData, "npm"))).toBeLessThan(entries.indexOf(packagedPath));
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

  it("keeps login shell execution on POSIX platforms", () => {
    expect(shellArgsForCommand("/bin/zsh", "codex --enable hooks", "darwin")).toEqual([
      "-l",
      "-c",
      "codex --enable hooks",
    ]);
  });
});
