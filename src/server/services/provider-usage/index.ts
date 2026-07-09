/**
 * Multi-provider usage aggregator — CodexBar fork surface for mission-control.
 * Every catalog id routes through a live adapter (credentials + probe).
 */

import type {
  ProviderUsageId,
  ProviderUsageResponse,
  ProviderUsageSnapshot,
} from "~/shared/provider-usage";
import {
  DEFAULT_PROVIDER_USAGE_IDS,
  emptyProviderSnapshot,
  isProviderUsageId,
} from "~/shared/provider-usage";
import { fetchProviderUsage } from "./all-adapters";

async function fetchOne(id: ProviderUsageId): Promise<ProviderUsageSnapshot> {
  try {
    return await fetchProviderUsage(id);
  } catch (err) {
    return emptyProviderSnapshot(
      id,
      "error",
      err instanceof Error ? err.message : "provider fetch failed",
    );
  }
}

/**
 * Aggregate usage for the requested provider ids (or mission-control defaults).
 * Never throws. Unknown ids are skipped.
 */
export async function getProviderUsage(
  requestedIds?: readonly string[] | null,
): Promise<ProviderUsageResponse> {
  const ids: ProviderUsageId[] = [];
  const seen = new Set<string>();
  const source =
    requestedIds && requestedIds.length > 0 ? requestedIds : DEFAULT_PROVIDER_USAGE_IDS;
  for (const raw of source) {
    if (!isProviderUsageId(raw) || seen.has(raw)) continue;
    seen.add(raw);
    ids.push(raw);
  }
  if (ids.length === 0) {
    for (const id of DEFAULT_PROVIDER_USAGE_IDS) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  const providers = await Promise.all(ids.map((id) => fetchOne(id)));
  return { providers, fetchedAt: Date.now() };
}

export { fetchProviderUsage } from "./all-adapters";
export { getCodexUsage, _resetCodexUsageCache, _setCodexCredsReaderForTests } from "./codex-usage";
export {
  getCursorUsage,
  _resetCursorUsageCache,
  _setCursorSessionReaderForTests,
} from "./cursor-usage";
