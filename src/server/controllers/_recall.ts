import { readRecallSettings } from "../services/recall-settings";
import { forbidden } from "./_helpers";

/**
 * 403 when the Recall master switch is off; null when the request may proceed.
 *
 * Gating the memory and code-graph APIs here keeps agent-facing MCP tools
 * honest — including sessions provisioned before the toggle flipped, whose MCP
 * config can't be hot-swapped. The task `brief` endpoint deliberately stays
 * open: it must hand back an EMPTY brief when disabled so the spawn path strips
 * any stale managed block from disk.
 */
export function requireRecallOn(): Response | null {
  return readRecallSettings().enabled ? null : forbidden("Recall is disabled");
}
