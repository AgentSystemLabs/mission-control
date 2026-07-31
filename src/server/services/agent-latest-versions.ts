/**
 * Latest published version lookup for managed agent CLIs. Prefer a provider's
 * native read-only JSON check when one is declared; otherwise use its npm
 * package. Agents with neither source are reported as unsupported. Cached per
 * agent; never throws.
 */

import type { TaskAgent } from "~/shared/domain";
import { AGENT_CLI_CONFIG } from "~/shared/agent-cli-config";
import { extractCliVersion } from "~/shared/agent-cli-version-compare";
import type { AgentLatestVersion } from "~/shared/agent-launchers";
import { runCli } from "./claude-cli";

export type { AgentLatestVersion } from "~/shared/agent-launchers";

const REQUEST_TIMEOUT_MS = 8_000;
const SUCCESS_TTL_MS = 3_600_000;
const FAILURE_TTL_MS = 300_000;

type CacheEntry = { value: AgentLatestVersion; expiresAt: number };
const cache = new Map<TaskAgent, CacheEntry>();
const inflight = new Map<TaskAgent, Promise<AgentLatestVersion>>();

type LatestVersionResult = { value: AgentLatestVersion; ttlMs: number };

function failure(
  agent: TaskAgent,
  checkedAt: string,
  error: string,
): LatestVersionResult {
  return {
    value: { agent, supported: true, latestVersion: null, checkedAt, error },
    ttlMs: FAILURE_TTL_MS,
  };
}

async function fetchLatestVersionFromCli(
  agent: TaskAgent,
  checkedAt: string,
): Promise<LatestVersionResult | null> {
  const config = AGENT_CLI_CONFIG[agent];
  const invocation = config.latestVersionCommand;
  if (!invocation) return null;

  try {
    const raw = await runCli(config.command, [...invocation.args], {
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const body = JSON.parse(raw) as Record<string, unknown>;
    const providerError = invocation.errorField
      ? body[invocation.errorField]
      : undefined;
    if (typeof providerError === "string" && providerError.trim()) {
      return failure(agent, checkedAt, providerError.trim());
    }
    const candidate = body[invocation.versionField];
    const version = typeof candidate === "string" ? extractCliVersion(candidate) : null;
    if (!version) return failure(agent, checkedAt, "no version in response");
    return {
      value: { agent, supported: true, latestVersion: version, checkedAt },
      ttlMs: SUCCESS_TTL_MS,
    };
  } catch {
    return failure(agent, checkedAt, "version check failed");
  }
}

async function fetchLatestVersion(agent: TaskAgent): Promise<LatestVersionResult> {
  const checkedAt = new Date().toISOString();
  const cliResult = await fetchLatestVersionFromCli(agent, checkedAt);
  if (cliResult) return cliResult;

  const npmPackage = AGENT_CLI_CONFIG[agent].npmPackage;
  if (!npmPackage) {
    return {
      value: { agent, supported: false, latestVersion: null, checkedAt },
      ttlMs: SUCCESS_TTL_MS,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${npmPackage}/latest`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "MissionControl" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return failure(agent, checkedAt, `unexpected status ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const version = typeof body.version === "string" ? extractCliVersion(body.version) : null;
    if (!version) {
      return failure(agent, checkedAt, "no version in response");
    }
    return {
      value: { agent, supported: true, latestVersion: version, checkedAt },
      ttlMs: SUCCESS_TTL_MS,
    };
  } catch (err) {
    return failure(
      agent,
      checkedAt,
      err instanceof Error ? err.message : "request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

function getOne(agent: TaskAgent, refresh: boolean): Promise<AgentLatestVersion> {
  const hit = cache.get(agent);
  if (!refresh && hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  const running = inflight.get(agent);
  if (running) return running;

  const p = fetchLatestVersion(agent)
    .then(({ value, ttlMs }) => {
      cache.set(agent, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      if (inflight.get(agent) === p) inflight.delete(agent);
    });
  inflight.set(agent, p);
  return p;
}

/** Cached single-flight latest-version lookup. Never throws. */
export function getAgentLatestVersions(
  agents: readonly TaskAgent[],
  opts?: { refresh?: boolean },
): Promise<AgentLatestVersion[]> {
  return Promise.all(agents.map((agent) => getOne(agent, opts?.refresh === true)));
}

export function _resetAgentLatestVersionsCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
