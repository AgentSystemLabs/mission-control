import type { TaskAgent } from "~/shared/domain";
import { MANAGED_AGENTS } from "~/shared/agent-cli-config";
import { readAgentAccounts } from "../services/agent-accounts";
import { getAgentLatestVersions } from "../services/agent-latest-versions";
import { json } from "./_helpers";

/** GET /api/agent-launchers/accounts — local sign-in status per managed agent CLI. */
export function accounts(): Response {
  return json({ accounts: readAgentAccounts() });
}

/**
 * GET /api/agent-launchers/latest-versions — latest published CLI versions.
 * Optional `?agents=claude-code,codex` filters; `?refresh=1` bypasses the cache.
 */
export async function latestVersions(url: URL): Promise<Response> {
  const raw = url.searchParams.get("agents");
  const requested = raw
    ? new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const agents: readonly TaskAgent[] = requested
    ? MANAGED_AGENTS.filter((agent) => requested.has(agent))
    : MANAGED_AGENTS;
  const refresh = url.searchParams.get("refresh") === "1";
  return json({ versions: await getAgentLatestVersions(agents, { refresh }) });
}
