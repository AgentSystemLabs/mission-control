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

// Per-provider-id result cache with single-flight, wrapping the generic
// adapters. The header polls provider usage on an interval and several viewers
// can request the same ids at once; without this every poll re-hits every
// provider's network endpoint. `claude`, `codex`, and `cursor` already run
// their own single-flight TTL caches downstream, so they are passed straight
// through to avoid double-caching (and to keep their richer freshness logic).
const PROVIDER_USAGE_SUCCESS_TTL_MS = 90_000;
const PROVIDER_USAGE_ERROR_TTL_MS = 30_000;
const SELF_CACHED_IDS: ReadonlySet<ProviderUsageId> = new Set<ProviderUsageId>([
  "claude",
  "codex",
  "cursor",
]);

type ProviderCacheEntry = { value: ProviderUsageSnapshot; expiresAt: number };
const providerCache = new Map<ProviderUsageId, ProviderCacheEntry>();
const providerInflight = new Map<ProviderUsageId, Promise<ProviderUsageSnapshot>>();

/** Run the adapter, normalizing any throw into an error snapshot (never throws). */
async function fetchOneUncached(id: ProviderUsageId): Promise<ProviderUsageSnapshot> {
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

async function fetchOne(id: ProviderUsageId): Promise<ProviderUsageSnapshot> {
  if (SELF_CACHED_IDS.has(id)) return fetchOneUncached(id);
  const now = Date.now();
  const cached = providerCache.get(id);
  if (cached && cached.expiresAt > now) return cached.value;
  const pending = providerInflight.get(id);
  if (pending) return pending;
  const p = fetchOneUncached(id)
    .then((value) => {
      // Non-ok results (unauthenticated/error/unavailable) get a shorter TTL so
      // a transient failure or a just-added credential recovers quickly.
      const ttl = value.status === "ok" ? PROVIDER_USAGE_SUCCESS_TTL_MS : PROVIDER_USAGE_ERROR_TTL_MS;
      providerCache.set(id, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => {
      if (providerInflight.get(id) === p) providerInflight.delete(id);
    });
  providerInflight.set(id, p);
  return p;
}

/** Test seam: clear the per-provider TTL + single-flight cache between tests. */
export function _resetProviderUsageCacheForTests(): void {
  providerCache.clear();
  providerInflight.clear();
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
