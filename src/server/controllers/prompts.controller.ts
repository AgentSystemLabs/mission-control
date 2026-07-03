import { z } from "zod";
import { PROMPT_SEARCH_LIMIT } from "~/shared/prompts";
import { searchPromptHistory } from "../services/prompts";
import { json, parseSearchParams } from "./_helpers";

const searchQuery = z.object({
  q: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? "", 10);
      return Number.isFinite(n) && n > 0 ? n : PROMPT_SEARCH_LIMIT;
    }),
});

export async function search(url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, searchQuery);
  if (!parsed.ok) return parsed.response;
  const prompts = searchPromptHistory(parsed.data.q ?? "", parsed.data.limit);
  return json({ prompts });
}
