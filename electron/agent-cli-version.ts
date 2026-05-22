import { spawnSync } from "node:child_process";
import type { AgentCliVersionRequirement } from "./agent-cli-version-requirements";

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
  "HOME",
  "PATH",
  "Path",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "USER",
  "WINDIR",
] as const;

export function extractCliVersion(text: string): string | null {
  const match = text.match(/\bv?(\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

function comparableVersionParts(version: string): number[] {
  const core = version.replace(/^v/i, "").split(/[-+]/)[0] ?? "";
  return core.split(".").map((part) => Number(part));
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

function baseCheckFields(requirement: AgentCliVersionRequirement) {
  return {
    label: requirement.label,
    requiredVersion: requirement.minimumVersion,
    packageUrl: requirement.packageUrl,
    updateCommands: requirement.updateCommands,
  };
}

export function checkAgentCliVersion(
  binary: string,
  env: NodeJS.ProcessEnv,
  requirement: AgentCliVersionRequirement,
): AgentVersionCheck {
  const result = spawnSync(binary, ["--version"], {
    env: versionProbeEnv(env),
    encoding: "utf8",
    timeout: VERSION_TIMEOUT_MS,
  });
  const output = cleanOutput(result.stdout, result.stderr);
  const version = extractCliVersion(output);

  if (version) {
    if (compareCliVersions(version, requirement.minimumVersion, requirement.versionScheme) >= 0) {
      return { ok: true, version, ...baseCheckFields(requirement) };
    }
    return {
      ok: false,
      reason: "outdated",
      version,
      output,
      ...baseCheckFields(requirement),
    };
  }

  return {
    ok: false,
    reason: result.error ? "version-check-failed" : "version-unknown",
    output,
    ...baseCheckFields(requirement),
  };
}

export function agentVersionErrorMessage(check: Exclude<AgentVersionCheck, { ok: true }>): string {
  if (check.reason === "outdated" && check.version) {
    return `${check.label} ${check.version} is installed, but MissionControl requires ${check.label} ${check.requiredVersion} or newer.`;
  }
  return `MissionControl could not verify the installed ${check.label} version. ${check.label} ${check.requiredVersion} or newer is required.`;
}
