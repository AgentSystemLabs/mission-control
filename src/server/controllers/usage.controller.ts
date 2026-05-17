import { z } from "zod";
import { getUsageSummary, syncTokenUsage } from "../services/token-usage";
import { json, parseSearchParams } from "./_helpers";

const DEFAULT_USAGE_DAYS = 30;
const MIN_USAGE_DAYS = 1;
const MAX_USAGE_DAYS = 365;

const usageParams = z.object({
  days: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? String(DEFAULT_USAGE_DAYS), 10) || DEFAULT_USAGE_DAYS;
      return Math.max(MIN_USAGE_DAYS, Math.min(MAX_USAGE_DAYS, n));
    }),
  sync: z.string().optional(),
});

export async function read(url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, usageParams);
  if (!parsed.ok) return parsed.response;
  const skipSync = parsed.data.sync === "0";
  const ingested = skipSync ? 0 : await syncTokenUsage();
  const summary = getUsageSummary(parsed.data.days);
  return json({ ...summary, ingested });
}
