import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

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

function existingPathEntries(entries: string[]): string[] {
  return entries.filter((entry) => {
    try {
      return fs.existsSync(entry);
    } catch {
      return false;
    }
  });
}

export function buildUserPath(basePath = process.env.PATH ?? ""): string {
  const home = os.homedir();
  const candidates = existingPathEntries([
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, "Library", "pnpm"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]);

  const seen = new Set<string>();
  const all = [...candidates, ...basePath.split(path.delimiter).filter(Boolean)];
  return all.filter((entry) => {
    if (seen.has(entry)) return false;
    seen.add(entry);
    return true;
  }).join(path.delimiter);
}

export function augmentProcessEnv(): void {
  process.env.PATH = buildUserPath();
  process.env.SHELL = resolveShell();
}

export function sanitizedProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  out.PATH = buildUserPath(out.PATH);
  out.SHELL = resolveShell();
  return out;
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
