import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentCliVersionRequirement } from "./agent-cli-version-requirements";
import { resolveAgentCliUpdateCommands } from "./agent-cli-version-requirements";
import { versionCore } from "../src/shared/semver";
import { buildCmdScriptCommand, isWindowsCommandScript } from "./windows-cmd";

export type AgentVersionCheck =
  | {
      ok: true;
      label: string;
      version: string;
      requiredVersion: string;
      packageUrl: string;
      updateCommands: readonly string[];
    }
  | {
      ok: false;
      reason: "outdated" | "version-check-failed" | "version-unknown";
      label: string;
      requiredVersion: string;
      packageUrl: string;
      updateCommands: readonly string[];
      version?: string;
      output?: string;
    };

const VERSION_TIMEOUT_MS = 3_000;
const OUTPUT_LIMIT = 500;
const VERSION_ENV_ALLOWLIST = [
  "APPDATA",
  "ComSpec",
  "CommonProgramFiles",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "Path",
  "PATHEXT",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USER",
  "USERPROFILE",
  "WINDIR",
] as const;

export function extractCliVersion(text: string): string | null {
  const match = text.match(/\bv?(\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

function comparableVersionParts(version: string): number[] {
  return versionCore(version).split(".").map((part) => Number(part));
}

export function compareCliVersions(
  a: string,
  b: string,
  scheme: AgentCliVersionRequirement["versionScheme"] = "semver",
): number {
  const left = comparableVersionParts(a);
  const right = comparableVersionParts(b);
  const length = Math.max(left.length, right.length, 3);
  // Cursor reports calendar builds like `2026.05.20-2b5dd59`. The hash is not
  // orderable, so compare only the date triplet and document that in config.
  const compareLength = scheme === "calendar-date" ? 3 : length;
  for (let i = 0; i < compareLength; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function cleanOutput(stdout: string | Buffer | null, stderr: string | Buffer | null): string {
  return [stdout, stderr]
    .map((value) => (value ? String(value) : ""))
    .join("\n")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim()
    .slice(0, OUTPUT_LIMIT);
}

function versionProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of VERSION_ENV_ALLOWLIST) {
    if (typeof env[key] === "string") out[key] = env[key];
  }
  return out;
}

function baseCheckFields(
  requirement: AgentCliVersionRequirement,
  platform: NodeJS.Platform = os.platform(),
) {
  return {
    label: requirement.label,
    requiredVersion: requirement.minimumVersion,
    packageUrl: requirement.packageUrl,
    updateCommands: resolveAgentCliUpdateCommands(requirement.updateCommands, platform),
  };
}

export function buildCliVersionProbe(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const probeEnv = versionProbeEnv(env);
  if (platform === "win32" && isWindowsCommandScript(binary)) {
    const systemRoot = env.SystemRoot ?? env.WINDIR ?? "C:\\Windows";
    const cmdExe = path.win32.join(systemRoot, "System32", "cmd.exe");
    const command = buildCmdScriptCommand(binary, ["--version"]);
    return {
      command: cmdExe,
      args: ["/d", "/s", "/c", command],
      env: probeEnv,
    };
  }

  return {
    command: binary,
    args: ["--version"],
    env: probeEnv,
  };
}

function spawnCliVersion(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
) {
  const probe = buildCliVersionProbe(binary, env, platform);
  return spawnSync(probe.command, probe.args, {
    env: probe.env,
    encoding: "utf8",
    timeout: VERSION_TIMEOUT_MS,
    windowsVerbatimArguments: platform === "win32" && isWindowsCommandScript(binary),
  });
}

export function checkAgentCliVersion(
  binary: string,
  env: NodeJS.ProcessEnv,
  requirement: AgentCliVersionRequirement,
  platform: NodeJS.Platform = os.platform(),
): AgentVersionCheck {
  const result = spawnCliVersion(binary, env, platform);
  const output = cleanOutput(result.stdout, result.stderr);
  const version = extractCliVersion(output);
  const fields = baseCheckFields(requirement, platform);

  if (version) {
    if (compareCliVersions(version, requirement.minimumVersion, requirement.versionScheme) >= 0) {
      return { ok: true, version, ...fields };
    }
    return {
      ok: false,
      reason: "outdated",
      version,
      output,
      ...fields,
    };
  }

  return {
    ok: false,
    reason: result.error ? "version-check-failed" : "version-unknown",
    output,
    ...fields,
  };
}

// pty:spawn runs the version probe synchronously on the main process, so an
// uncached probe blocks ALL windows for its full duration (the agent CLI is a
// Node app; `--version` alone can take seconds). Opening many sessions at once
// (the grid view) would serialize N probes and freeze the app. A passing probe
// is cached for the app's lifetime; a failing one is retried after a short TTL
// so an in-place CLI update is picked up without restarting Mission Control.
const versionCheckCache = new Map<string, { check: AgentVersionCheck; at: number }>();
const VERSION_CHECK_FAILURE_TTL_MS = 30_000;

export function checkAgentCliVersionCached(
  binary: string,
  env: NodeJS.ProcessEnv,
  requirement: AgentCliVersionRequirement,
  platform: NodeJS.Platform = os.platform(),
): AgentVersionCheck {
  const key = `${binary}\0${requirement.label}\0${requirement.minimumVersion}`;
  const hit = versionCheckCache.get(key);
  if (hit && (hit.check.ok || Date.now() - hit.at < VERSION_CHECK_FAILURE_TTL_MS)) {
    return hit.check;
  }
  const check = checkAgentCliVersion(binary, env, requirement, platform);
  versionCheckCache.set(key, { check, at: Date.now() });
  return check;
}

export function clearAgentCliVersionCache(): void {
  versionCheckCache.clear();
}

export function agentVersionErrorMessage(check: Exclude<AgentVersionCheck, { ok: true }>): string {
  if (check.reason === "outdated" && check.version) {
    return `${check.label} ${check.version} is installed, but MissionControl requires ${check.label} ${check.requiredVersion} or newer.`;
  }
  return `MissionControl could not verify the installed ${check.label} version. ${check.label} ${check.requiredVersion} or newer is required.`;
}
