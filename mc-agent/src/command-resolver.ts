import * as fs from "node:fs";
import * as path from "node:path";
import { pathLookupCandidates } from "../../src/shared/agent-cli-config";

function isExecutableFile(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * POSIX equivalent of electron/shell-env.ts `resolveCommandOnPath`. The sandbox
 * is always Linux, so this only needs the `PATH`-scan branch (no Windows
 * PATHEXT handling).
 */
export function resolveCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (command.includes("/")) {
    return isExecutableFile(command) ? command : null;
  }
  const pathDirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** Resolve an agent command (claude/codex/cursor-agent), trying its known aliases. */
export function resolveAgentCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const candidate of pathLookupCandidates(command)) {
    const resolved = resolveCommandOnPath(candidate, env);
    if (resolved) return resolved;
  }
  return null;
}
