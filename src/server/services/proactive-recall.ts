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
  // The scope filter runs IN the search (before its limit) — filtering the top
  // N afterwards could discard every hit even when in-scope matches exist.
  try {
    const memories = searchMemory(projectId, query, MAX_MEMORIES, {
      scopeIds: [scopeId, LOCAL_SCOPE_ID],
    });
    if (memories.length) {
      sections.push(
        ["Relevant project memory (from Recall):", ...memories.map(renderMemoryLine)].join("\n"),
      );
    }
  } catch {
    // omit the memory section on any failure
  }

  // Related code symbols — only when the graph feature is on, the project is
  // indexed, and the prompt actually names something identifier-shaped. Probe
  // the best few candidate tokens (the longest one may simply not be in the
  // graph) until the section is full.
  if (settings.codeGraphEnabled) {
    try {
      const symbols = pickSymbolQueries(query);
      if (symbols.length && getGraphStatus(projectId).indexed) {
        const hits: { name: string; kind: string; filePath: string }[] = [];
        const seen = new Set<string>();
        for (const symbol of symbols) {
          if (hits.length >= MAX_GRAPH) break;
          for (const h of searchGraph(projectId, symbol, MAX_GRAPH)) {
            if (hits.length >= MAX_GRAPH) break;
            const key = `${h.name}|${h.filePath}`;
            if (seen.has(key)) continue;
            seen.add(key);
            hits.push(h);
          }
        }
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
  // Trim to the budget at a word boundary so we don't cut mid-identifier — but
  // if that boundary sits far back (one giant unbroken token would otherwise
  // eat most of the block), fall back to a hard slice.
  const soft = text.slice(0, budget).replace(/\s+\S*$/, "");
  if (soft.length >= budget * 0.6) return soft + "…";
  return text.slice(0, budget - 1) + "…";
}

/**
 * Pick the most "symbol-like" tokens from a prompt to probe the code graph
 * with, best first. Prefers camelCase/PascalCase or snake_case identifiers;
 * otherwise words of length ≥ 5. Longer tokens rank first (more specific).
 * Returns [] when nothing looks worth a lookup.
 */
export function pickSymbolQueries(text: string, max = 3): string[] {
  const tokens = text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g);
  if (!tokens) return [];
  const identifierish = tokens.filter(
    (t) => /[A-Z]/.test(t) || t.includes("_") || t.includes("$"),
  );
  const pool = identifierish.length ? identifierish : tokens.filter((t) => t.length >= 5);
  return [...new Set(pool)].sort((a, b) => b.length - a.length).slice(0, max);
}

/** The single best symbol candidate (kept for existing callers/tests). */
export function pickSymbolQuery(text: string): string {
  return pickSymbolQueries(text, 1)[0] ?? "";
}
