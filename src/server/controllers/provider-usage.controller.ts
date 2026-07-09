import { getProviderUsage } from "../services/provider-usage";
import { json } from "./_helpers";

/**
 * GET /api/provider-usage — multi-provider usage limits (CodexBar fork).
 * Optional `?providers=claude,codex,cursor` filters which adapters run.
 */
export async function read(url: URL): Promise<Response> {
  const raw = url.searchParams.get("providers");
  const ids = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  return json(await getProviderUsage(ids));
}
