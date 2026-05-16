import { z } from "zod";
import { getUsageSummary, syncTokenUsage } from "../services/token-usage";
import { json, parseSearchParams } from "./_helpers";

const usageParams = z.object({
  days: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? "30", 10) || 30;
      return Math.max(1, Math.min(365, n));
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
