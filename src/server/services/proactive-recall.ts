// Proactive per-turn recall: before the agent answers, surface the memories and
// code-graph symbols most relevant to the user's prompt so it USES Recall without
// having to call mem_search/graph_search first. Assembled from the same indexed
// SQLite reads the MCP tools use — synchronous and millisecond-scale, safe inside
// the UserPromptSubmit hook's 3s budget. Returns "" when nothing is relevant, so
// the hook injects nothing.

import { searchMemory, renderMemoryLine } from "./project-memory";
import { getGraphStatus, searchGraph } from "./code-graph";
import { readRecallSettings } from "./recall-settings";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

const DEFAULT_BUDGET = 800;
const MAX_MEMORIES = 5;
const MAX_GRAPH = 3;

export interface TurnContextOptions {
  /** Hard cap on the injected block; the tail is trimmed at a word boundary. */
  budget?: number;
}

/**
 * Build the compact "here's what Recall knows about this" block for a single
 * turn. Best-effort: any sub-query failing just omits that section. The scopeId
 * scopes memories to this runtime plus the shared "local" scope, matching the
 * Session Brief.
 */
export function assembleTurnContext(
  projectId: string,
  scopeId: string,
  promptText: string,
  options: TurnContextOptions = {},
): string {
  const query = promptText.trim();
  if (!query) return "";
  const budget = options.budget ?? DEFAULT_BUDGET;
  const settings = readRecallSettings();

  const sections: string[] = [];

  // Relevant memories, scoped like the brief (this runtime or shared "local").
  try {
    const memories = searchMemory(projectId, query, MAX_MEMORIES)
      .filter((m) => m.scopeId === scopeId || m.scopeId === LOCAL_SCOPE_ID)
      .slice(0, MAX_MEMORIES);
    if (memories.length) {
      sections.push(
        ["Relevant project memory (from Recall):", ...memories.map(renderMemoryLine)].join("\n"),
      );
    }
  } catch {
    // omit the memory section on any failure
  }

  // Related code symbols — only when the graph feature is on, the project is
  // indexed, and the prompt actually names something identifier-shaped.
  if (settings.codeGraphEnabled) {
    try {
      const symbol = pickSymbolQuery(query);
      if (symbol && getGraphStatus(projectId).indexed) {
        const hits = searchGraph(projectId, symbol, MAX_GRAPH);
        if (hits.length) {
          sections.push(
            [
              "Related code (from the Recall code graph):",
              ...hits.map((h) => `- ${h.name} (${h.kind}) — ${h.filePath}`),
            ].join("\n"),
          );
        }
      }
    } catch {
      // omit the code section on any failure
    }
  }

  if (!sections.length) return "";
  const text = sections.join("\n\n");
  if (text.length <= budget) return text;
  // Trim to the budget at a word boundary so we don't cut mid-identifier.
  return text.slice(0, budget).replace(/\s+\S*$/, "") + "…";
}

/**
 * Pick the single most "symbol-like" token from a prompt to probe the code graph
 * with. Prefers camelCase/PascalCase or snake_case identifiers; otherwise the
 * longest word of length ≥ 5. Returns "" when nothing looks worth a lookup.
 */
export function pickSymbolQuery(text: string): string {
  const tokens = text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g);
  if (!tokens) return "";
  const identifierish = tokens.filter(
    (t) => /[A-Z]/.test(t) || t.includes("_") || t.includes("$"),
  );
  const pool = identifierish.length ? identifierish : tokens.filter((t) => t.length >= 5);
  if (!pool.length) return "";
  return pool.reduce((best, t) => (t.length > best.length ? t : best));
}
