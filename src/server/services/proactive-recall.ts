// Proactive per-turn recall: before the agent answers, surface the memories and
// code-graph symbols most relevant to the user's prompt so it USES Recall without
// having to call mem_search/graph_search first. Assembled from the same indexed
// SQLite reads the MCP tools use — synchronous and millisecond-scale, safe inside
// the UserPromptSubmit hook's 3s budget. Returns "" when nothing is relevant, so
// the hook injects nothing.

import { searchMemory, renderMemoryLine } from "./project-memory";
import { getGraphStatus, searchGraphFuzzy } from "./code-graph";
import { readRecallSettings } from "./recall-settings";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

const DEFAULT_BUDGET = 800;
const MAX_MEMORIES = 5;
const MAX_GRAPH = 3;

export interface TurnContextOptions {
  /** Hard cap on the injected block; the tail is trimmed at a word boundary. */
  budget?: number;
}

// The MCP server id Recall is registered under (see ensure-recall-mcp.ts) and its
// tool set. Claude Code namespaces MCP tools as `mcp__<serverId>__<tool>`, which
// is also the shape ToolSearch's `select:` filter expects.
const RECALL_MCP_SERVER_ID = "recall";
export const RECALL_MCP_TOOLS = [
  "mem_search",
  "mem_context",
  "mem_save",
  "mem_update",
  "graph_search",
  "graph_node",
  "get_neighbors",
  "impact_of",
  "shortest_path",
] as const;

/**
 * The first-turn instruction that force-loads Recall's deferred MCP tools. Claude
 * Code loads MCP tools on demand (behind a ToolSearch), so a fresh session cannot
 * call the mem_ and graph_ tools until it runs one — the Session Brief only tells it
 * the tools exist. Injecting this once at the start of a session gets them loaded
 * so the agent can actually query the graph and save memories, not just read the
 * context we inject. The caller decides when it fires (once per session, Claude
 * only); this just renders the text.
 */
export function renderToolLoadInstruction(): string {
  const select = RECALL_MCP_TOOLS.map((t) => `mcp__${RECALL_MCP_SERVER_ID}__${t}`).join(",");
  return [
    "Recall's project-memory and code-graph tools are available in this session but load on demand. Before answering, run this once to load them:",
    `→ ToolSearch with query "select:${select}"`,
    "Then use `graph_search` / `graph_node` / `get_neighbors` / `impact_of` / `shortest_path` to navigate code instead of grepping — `graph_node` returns a symbol's verbatim source, so you often don't need to Read the file — and `mem_search` / `mem_context` to recall prior decisions (and `mem_save` to record new ones).",
  ].join("\n");
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

  let memoryBlock = "";
  let codeBlock = "";

  // Relevant memories, scoped like the brief (this runtime or shared "local").
  // The scope filter runs IN the search (before its limit) — filtering the top
  // N afterwards could discard every hit even when in-scope matches exist.
  try {
    const memories = searchMemory(projectId, query, MAX_MEMORIES, {
      scopeIds: [scopeId, LOCAL_SCOPE_ID],
    });
    if (memories.length) {
      memoryBlock = ["Relevant project memory (from Recall):", ...memories.map(renderMemoryLine)].join(
        "\n",
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
          // Probe each token's variants (stemmed / sub-words) so a descriptive
          // word finds a differently-spelled symbol — e.g. "toaster" → "toast"
          // finds `mcToast*`, which the raw word never would.
          for (const variant of symbolVariants(symbol)) {
            if (hits.length >= MAX_GRAPH) break;
            for (const h of searchGraphFuzzy(projectId, variant, MAX_GRAPH)) {
              if (hits.length >= MAX_GRAPH) break;
              const key = `${h.name}|${h.filePath}`;
              if (seen.has(key)) continue;
              seen.add(key);
              hits.push(h);
            }
          }
        }
        if (hits.length) {
          // Re-arm the tool nudge every turn (the start-of-session brief's nudge
          // goes stale): point the agent at the graph tools rather than grep.
          codeBlock = [
            "Related code (from the Recall code graph):",
            ...hits.map((h) => `- ${h.name} (${h.kind}) — ${h.filePath}`),
            "→ Trace callers/impact with `get_neighbors` / `impact_of`, read a definition with `graph_node` (returns the source — no file Read needed), or locate more with `graph_search` — prefer these over grep.",
          ].join("\n");
        }
      }
    } catch {
      // omit the code section on any failure
    }
  }

  // Guarantee the code section its slot: it's small and bounded (≤ MAX_GRAPH
  // lines + nudge), and it's the part the agent otherwise ignores — so reserve
  // room for it and trim MEMORY to what's left, rather than letting an abundant
  // memory section crowd the code out of a shared budget (which starved it before).
  if (!memoryBlock && !codeBlock) return "";
  const sep = memoryBlock && codeBlock ? "\n\n" : "";
  const memBudget = budget - (codeBlock ? codeBlock.length + sep.length : 0);
  const mem = memoryBlock && memoryBlock.length > memBudget
    ? trimToBudget(memoryBlock, Math.max(0, memBudget))
    : memoryBlock;
  const out = [mem, codeBlock].filter(Boolean).join("\n\n");
  // Safety net if even the (bounded) code block alone overruns the budget.
  return out.length <= budget ? out : trimToBudget(out, budget);
}

/**
 * Trim to a character budget at a word boundary (so we don't cut mid-identifier),
 * with a hard-slice fallback when that boundary sits so far back that one giant
 * unbroken token would otherwise eat most of the block. Exported for the
 * SessionStart brief fallback, which must fit the hook-output size limit.
 */
export function trimToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const soft = text.slice(0, budget).replace(/\s+\S*$/, "");
  if (soft.length >= budget * 0.6) return soft + "…";
  return text.slice(0, budget - 1) + "…";
}

// Common English/grammar words and generic action verbs are terrible symbol
// probes: they substring-match dozens of unrelated symbols and crowd out the
// specific noun. ("handle" in "where do we handle toasts" matched
// handleDomainError / registerPtyHandlers and buried `mcToast*`.) Dropped from
// the plain-word fallback ONLY — a deliberate identifier like `handleClick` is
// still honored because it's caught by the identifier branch first.
const SYMBOL_STOPWORDS = new Set([
  "where", "when", "what", "which", "whose", "how", "does", "did", "done", "doing",
  "the", "this", "that", "these", "those", "then", "than", "them", "they", "their",
  "there", "here", "have", "has", "had", "having", "will", "would", "should",
  "could", "shall", "might", "must", "can", "cannot", "been", "being", "are",
  "was", "were", "and", "but", "for", "nor", "yet", "all", "any", "some", "each",
  "from", "into", "onto", "over", "under", "with", "within", "without", "about",
  "also", "your", "you", "yours", "our", "ours", "its", "please", "make", "makes",
  "made", "making", "work", "works", "working", "need", "needs", "want", "wants",
  "show", "shows", "showing", "find", "finds", "look", "looks", "help", "handle",
  "handles", "handled", "handling", "happen", "happens", "happening", "thing",
  "things", "something", "anything",
]);

/**
 * Pick the most "symbol-like" tokens from a prompt to probe the code graph
 * with, best first. Prefers camelCase/PascalCase or snake_case identifiers;
 * otherwise plain words of length ≥ 4 that aren't stopwords (so a specific noun
 * like "toasts"/"grid" survives instead of a generic verb like "handle").
 * Longer tokens rank first (more specific). Returns [] when nothing's worth it.
 */
export function pickSymbolQueries(text: string, max = 3): string[] {
  const tokens = text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g);
  if (!tokens) return [];
  const identifierish = tokens.filter(
    (t) => /[A-Z]/.test(t) || t.includes("_") || t.includes("$"),
  );
  const pool = identifierish.length
    ? identifierish
    : tokens.filter((t) => t.length >= 4 && !SYMBOL_STOPWORDS.has(t.toLowerCase()));
  return [...new Set(pool)].sort((a, b) => b.length - a.length).slice(0, max);
}

// Conservative suffixes, longest-first, stripped only when ≥ 4 chars remain so
// the stem stays a real searchable prefix. Deliberately excludes -ing/-ings
// (they over-stem plurals like "settings" → "sett").
const STEM_SUFFIXES = ["ers", "er", "s"] as const;

function stemWord(word: string): string | null {
  const lower = word.toLowerCase();
  for (const suf of STEM_SUFFIXES) {
    if (word.length - suf.length >= 4 && lower.endsWith(suf)) {
      return word.slice(0, word.length - suf.length);
    }
  }
  return null;
}

/**
 * Expand a picked token into the forms worth probing the graph with, most
 * specific first: the token itself, its camelCase/snake/`$` sub-words, and a
 * lightly-stemmed form (drop a trailing -er/-ers/-s, e.g. "toaster" → "toast",
 * "toasts" → "toast"). This is what lets a natural-language word reach a
 * differently-spelled symbol. Case-insensitively deduped, original form kept.
 */
export function symbolVariants(token: string): string[] {
  const out: string[] = [token];
  const parts = token
    .split(/(?<=[a-z0-9])(?=[A-Z])|[_$]/)
    .filter((p) => p.length >= 3 && p !== token);
  out.push(...parts);
  for (const base of [token, ...parts]) {
    const stemmed = stemWord(base);
    if (stemmed) out.push(stemmed);
  }
  const seen = new Set<string>();
  return out.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The single best symbol candidate (kept for existing callers/tests). */
export function pickSymbolQuery(text: string): string {
  return pickSymbolQueries(text, 1)[0] ?? "";
}
