import * as os from "node:os";
import type { AgentCliVersionRequirement } from "../src/shared/agent-cli-config";
import { pathLookupCandidates } from "../src/shared/agent-cli-config";
import {
  checkAgentCliVersionCached,
  type AgentVersionCheck,
} from "./agent-cli-version";
import { resolveAllCommandsOnPath, resolveCommandOnPath } from "./shell-env";

export function resolveAgentCommandOnPath(
  command: string,
  env?: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
): string | null {
  for (const candidate of pathLookupCandidates(command)) {
    const resolved = resolveCommandOnPath(candidate, env, platform);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveAllAgentCommandsOnPath(
  command: string,
  env?: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();
  for (const candidate of pathLookupCandidates(command)) {
    for (const resolved of resolveAllCommandsOnPath(candidate, env, platform)) {
      const key = platform === "win32" ? resolved.toLowerCase() : resolved;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(resolved);
    }
  }
  return matches;
}

/**
 * Walk every PATH match for a managed agent CLI and prefer the first binary
 * that satisfies the minimum version. Users commonly have a stale Homebrew or
 * Codex.app install earlier on PATH than a newer npm/Herd install; stopping at
 * the first match caused false "outdated" errors.
 *
 * If every candidate is outdated/unreadable, returns the first candidate so the
 * caller can surface the existing version-error UX.
 */
export function resolveAgentCommandMeetingVersion(
  command: string,
  requirement: AgentCliVersionRequirement,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = os.platform(),
  opts?: { fresh?: boolean },
): { binary: string; check: AgentVersionCheck } | null {
  const candidates = resolveAllAgentCommandsOnPath(command, env, platform);
  if (candidates.length === 0) return null;

  let fallback: { binary: string; check: AgentVersionCheck } | null = null;
  for (const binary of candidates) {
    const check = checkAgentCliVersionCached(binary, env, requirement, platform, opts);
    if (check.ok) return { binary, check };
    fallback ??= { binary, check };
  }
  return fallback;
}
