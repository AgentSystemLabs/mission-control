import { getClaudeUsageLimits } from "../services/claude-usage-limits";
import { json } from "./_helpers";

/** GET /api/claude-usage-limits — live Claude session + weekly rate-limit windows. */
export async function read(): Promise<Response> {
  return json(await getClaudeUsageLimits());
}
