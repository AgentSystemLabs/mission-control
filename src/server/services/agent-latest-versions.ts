/**
 * Latest published version lookup for the managed agent CLIs via the npm
 * registry. Agents without an npm package (Cursor) are reported as
 * unsupported instead of guessing. Cached per agent; never throws.
 */

import type { TaskAgent } from "~/shared/domain";
import { AGENT_CLI_CONFIG } from "~/shared/agent-cli-config";
import { extractCliVersion } from "~/shared/agent-cli-version-compare";
import type { AgentLatestVersion } from "~/shared/agent-launchers";

export type { AgentLatestVersion } from "~/shared/agent-launchers";

const REQUEST_TIMEOUT_MS = 8_000;
const SUCCESS_TTL_MS = 3_600_000;
const FAILURE_TTL_MS = 300_000;

type CacheEntry = { value: AgentLatestVersion; expiresAt: number };
const cache = new Map<TaskAgent, CacheEntry>();
const inflight = new Map<TaskAgent, Promise<AgentLatestVersion>>();

async function fetchLatestVersion(agent: TaskAgent): Promise<{ value: AgentLatestVersion; ttlMs: number }> {
  const npmPackage = AGENT_CLI_CONFIG[agent].npmPackage;
  const checkedAt = new Date().toISOString();
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
      return {
        value: {
          agent,
          supported: true,
          latestVersion: null,
          checkedAt,
          error: `unexpected status ${res.status}`,
        },
        ttlMs: FAILURE_TTL_MS,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    const version = typeof body.version === "string" ? extractCliVersion(body.version) : null;
    if (!version) {
      return {
        value: { agent, supported: true, latestVersion: null, checkedAt, error: "no version in response" },
        ttlMs: FAILURE_TTL_MS,
      };
    }
    return {
      value: { agent, supported: true, latestVersion: version, checkedAt },
      ttlMs: SUCCESS_TTL_MS,
    };
  } catch (err) {
    return {
      value: {
        agent,
        supported: true,
        latestVersion: null,
        checkedAt,
        error: err instanceof Error ? err.message : "request failed",
      },
      ttlMs: FAILURE_TTL_MS,
    };
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
