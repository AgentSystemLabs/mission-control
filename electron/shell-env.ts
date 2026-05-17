import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

type BuildUserPathOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  pathExists?: (entry: string) => boolean;
};

function pathEnvKey(platform: NodeJS.Platform = os.platform()): "PATH" | "Path" {
  return platform === "win32" ? "Path" : "PATH";
}

function envPathValue(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform()
): string {
  if (platform === "win32") return env.Path ?? env.PATH ?? env.path ?? "";
  return env.PATH ?? env.Path ?? env.path ?? "";
}

export function setCanonicalPathEnv(
  env: Record<string, string>,
  value: string,
  platform: NodeJS.Platform = os.platform()
): Record<string, string> {
  const key = pathEnvKey(platform);
  for (const variant of ["PATH", "Path", "path"] as const) {
    if (variant !== key) delete env[variant];
  }
  env[key] = value;
  return env;
}

function userShellFromDirectoryService(): string | null {
  if (os.platform() !== "darwin") return null;
  try {
    const username = os.userInfo().username;
    const result = spawnSync("/usr/bin/dscl", [".", "-read", `/Users/${username}`, "UserShell"], {
      encoding: "utf8",
      timeout: 1000,
    });
    const match = result.stdout.match(/UserShell:\s*(\S+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function resolveShell(): string {
  const envShell = process.env.SHELL;
  if (envShell && fs.existsSync(envShell)) return envShell;

  const infoShell = (os.userInfo() as { shell?: string }).shell;
  if (infoShell && fs.existsSync(infoShell)) return infoShell;

  const dsclShell = userShellFromDirectoryService();
  if (dsclShell && fs.existsSync(dsclShell)) return dsclShell;

  if (os.platform() === "win32") return "powershell.exe";
  for (const candidate of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "/bin/sh";
}

function existingPathEntries(
  entries: Array<string | undefined>,
  pathExists: (entry: string) => boolean = fs.existsSync
): string[] {
  return entries.filter((entry) => {
    if (!entry) return false;
    try {
      return pathExists(entry);
    } catch {
      return false;
    }
  }) as string[];
}

function compareVersionishNamesDesc(a: string, b: string): number {
  const parse = (value: string): number[] | null => {
    const match = value.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
  };

  const av = parse(a);
  const bv = parse(b);
  if (av && bv) {
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const diff = (bv[i] ?? 0) - (av[i] ?? 0);
      if (diff !== 0) return diff;
    }
  }
  if (av && !bv) return -1;
  if (!av && bv) return 1;
  return b.localeCompare(a);
}

function existingChildDirs(parent: string | undefined, childPath: string[] = []): string[] {
  if (!parent) return [];
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => compareVersionishNamesDesc(a.name, b.name))
      .map((entry) => path.join(parent, entry.name, ...childPath));
  } catch {
    return [];
  }
}

function windowsNvmPathCandidates(env: NodeJS.ProcessEnv): string[] {
  const nvmHome = env.NVM_HOME;
  return [
    env.NVM_SYMLINK,
    nvmHome,
    ...existingChildDirs(nvmHome),
  ].filter((entry): entry is string => !!entry);
}

function posixNvmPathCandidates(home: string, env: NodeJS.ProcessEnv): string[] {
  const nvmDir = env.NVM_DIR ?? path.join(home, ".nvm");
  return existingChildDirs(path.join(nvmDir, "versions", "node"), ["bin"]);
}

function posixFnmPathCandidates(home: string, env: NodeJS.ProcessEnv): string[] {
  const fnmDir = env.FNM_DIR ?? path.join(home, ".fnm");
  return [
    ...existingChildDirs(path.join(fnmDir, "node-versions"), ["installation", "bin"]),
    ...existingChildDirs(path.join(fnmDir, "aliases"), ["bin"]),
  ];
}

function windowsPathCandidates(home: string, env: NodeJS.ProcessEnv): Array<string | undefined> {
  const systemRoot = env.SystemRoot ?? env.WINDIR ?? "C:\\Windows";
  const localAppData = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const voltaHome = env.VOLTA_HOME ?? path.join(home, ".volta");
  const pnpmHome = env.PNPM_HOME ?? path.join(localAppData, "pnpm");

  return [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".codex", "bin"),
    path.join(home, ".cursor", "bin"),
    path.join(appData, "npm"),
    path.join(appData, ".npm-global", "bin"),
    path.join(voltaHome, "bin"),
    pnpmHome,
    path.join(localAppData, "pnpm"),
    path.join(localAppData, "Microsoft", "WindowsApps"),
    path.join(localAppData, "Programs", "Cursor", "resources", "app", "bin"),
    path.join(localAppData, "Programs", "cursor", "resources", "app", "bin"),
    ...windowsNvmPathCandidates(env),
    path.join(programFiles, "nodejs"),
    path.join(programFiles, "Git", "cmd"),
    path.join(programFiles, "Git", "bin"),
    path.join(programFiles, "Git", "usr", "bin"),
    path.join(programFilesX86, "nodejs"),
    path.join(programFilesX86, "Git", "cmd"),
    path.join(programFilesX86, "Git", "bin"),
    path.join(systemRoot, "System32"),
    systemRoot,
  ];
}

function posixPathCandidates(home: string, env: NodeJS.ProcessEnv): string[] {
  const pnpmHome = env.PNPM_HOME ?? path.join(home, ".local", "share", "pnpm");
  const voltaHome = env.VOLTA_HOME ?? path.join(home, ".volta");

  return [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, "Library", "pnpm"),
    path.join(home, ".npm-global", "bin"),
    path.join(voltaHome, "bin"),
    pnpmHome,
    path.join(home, ".yarn", "bin"),
    path.join(home, ".config", "yarn", "global", "node_modules", ".bin"),
    ...posixNvmPathCandidates(home, env),
    ...posixFnmPathCandidates(home, env),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/snap/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

export function buildUserPath(
  basePath = envPathValue(process.env),
  options: BuildUserPathOptions = {}
): string {
  const platform = options.platform ?? os.platform();
  const env = options.env ?? process.env;
  const home = options.homeDir ?? os.homedir();
  const pathExists = options.pathExists ?? fs.existsSync;
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const candidates = existingPathEntries(
    platform === "win32" ? windowsPathCandidates(home, env) : posixPathCandidates(home, env),
    pathExists
  );

  const seen = new Set<string>();
  const baseEntries = basePath.split(delimiter).filter(Boolean);
  // Windows GUI launches often inherit a PATH dominated by the packaged app and
  // system directories, so known user install locations must lead. POSIX shells
  // commonly carry the active Node manager selection in PATH; preserve that
  // order so we don't accidentally pick an older global CLI from another NVM
  // version just because it appeared first in fs.readdir().
  const all =
    platform === "win32"
      ? [...candidates, ...baseEntries]
      : [...baseEntries, ...candidates];
  return all.filter((entry) => {
    const key = platform === "win32" ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(delimiter);
}

export function augmentProcessEnv(): void {
  setCanonicalPathEnv(
    process.env as Record<string, string>,
    buildUserPath(envPathValue(process.env)),
    os.platform()
  );
  process.env.SHELL = resolveShell();
}

export function sanitizedProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  setCanonicalPathEnv(out, buildUserPath(envPathValue(out)), os.platform());
  out.SHELL = resolveShell();
  return out;
}

function commandNames(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== "win32" || path.extname(command)) return [command];
  const pathext = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  return [command, ...pathext.map((ext) => `${command}${ext.toLowerCase()}`)];
}

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (platform === "win32") return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = sanitizedProcessEnv(),
  platform: NodeJS.Platform = os.platform()
): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  const hasPathSeparator = trimmed.includes("/") || trimmed.includes("\\");
  const names = commandNames(trimmed, env, platform);

  if (hasPathSeparator || path.isAbsolute(trimmed)) {
    for (const name of names) {
      if (isExecutableFile(name, platform)) return name;
    }
    return null;
  }

  const pathValue = envPathValue(env, platform);
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

function shellBasename(shell: string): string {
  return path.basename(shell).toLowerCase();
}

function isPowerShell(shell: string): boolean {
  const base = shellBasename(shell);
  return base === "powershell.exe" || base === "pwsh.exe" || base === "powershell" || base === "pwsh";
}

function isCmd(shell: string): boolean {
  const base = shellBasename(shell);
  return base === "cmd.exe" || base === "cmd";
}

export function shellArgsForCommand(
  shell: string,
  command: string | undefined,
  platform: NodeJS.Platform = os.platform()
): string[] {
  const cmd = command?.trim();
  if (!cmd) {
    if (platform === "win32" && isPowerShell(shell)) return ["-NoLogo"];
    if (platform === "win32" && isCmd(shell)) return ["/d"];
    return platform === "win32" ? [] : ["-l"];
  }

  if (platform === "win32" && isPowerShell(shell)) {
    return ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd];
  }
  if (platform === "win32" && isCmd(shell)) return ["/d", "/s", "/c", cmd];
  return ["-l", "-c", cmd];
}
