#!/usr/bin/env node
// Recall — stdio MCP server for local Claude Code sessions. A thin transport
// shim exposing BOTH Recall pillars to the agent: project MEMORY (mem_*) and the
// code GRAPH (graph_*). It resolves the current project from MC_TASK_ID and
// proxies each tool to the embedded server's /api/projects/:id/* endpoints (the
// same resolve-project-from-task + bearer-token pattern the Recall skill uses),
// so all logic stays server-side. The agent (Claude) spawns this via a managed
// `.mcp.json` entry and it inherits MC_API_URL / MC_API_TOKEN / MC_TASK_ID from
// the session env. See electron/ensure-recall-mcp.ts.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.MC_API_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.MC_API_TOKEN || "";
const TASK_ID = process.env.MC_TASK_ID || "";

// Recall's memory types (mirror of src/shared/project-memory.ts MEMORY_TYPES).
const MEMORY_TYPES = [
  "overview",
  "stack",
  "architecture",
  "decision",
  "convention",
  "glossary",
  "known-issue",
  "preference",
  "discovery",
];

async function apiRequest(method, path, body) {
  if (!API_URL) throw new Error("MC_API_URL is not set");
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

const apiGet = (path) => apiRequest("GET", path);
const apiPost = (path, body) => apiRequest("POST", path, body);
const apiPatch = (path, body) => apiRequest("PATCH", path, body);

// Resolve (and cache) the project id for this session from its task.
let projectIdPromise = null;
function resolveProjectId() {
  if (!projectIdPromise) {
    projectIdPromise = (async () => {
      if (!TASK_ID) throw new Error("MC_TASK_ID is not set");
      const { task } = await apiGet(`/api/tasks/${encodeURIComponent(TASK_ID)}`);
      if (!task || !task.projectId) throw new Error("could not resolve project from task");
      return task.projectId;
    })().catch((err) => {
      projectIdPromise = null; // never cache a failed resolution
      throw err;
    });
  }
  return projectIdPromise;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}
function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

// When a graph query comes back empty, explain why (not indexed / still
// building) rather than returning a bare "no results".
async function emptyGraphHint(projectId) {
  try {
    const { status } = await apiGet(`/api/projects/${projectId}/graph/status`);
    if (status?.indexing) {
      const p = status.indexing;
      const pct = p.filesTotal > 0 ? Math.round((p.filesDone / p.filesTotal) * 100) : 0;
      return `The code graph is still building — ${pct}% done (${p.filesDone}/${p.filesTotal} files). Try again shortly.`;
    }
    if (!status?.indexed) {
      return "This project's code graph isn't indexed yet. Build it from Mission Control's Recall panel (Code graph → Build), then retry.";
    }
  } catch {
    /* fall through to the generic message */
  }
  return null;
}

async function runTool(fn) {
  try {
    const projectId = await resolveProjectId();
    return await fn(projectId);
  } catch (err) {
    return errorResult(`recall: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function nodeLine(n) {
  const exp = n.exported ? " exported" : "";
  const sig = n.signature ? ` ${n.signature}` : "";
  return `- ${n.name} (${n.kind}${exp}) — ${n.filePath}:${n.startLine} [degree ${n.degree}]${sig}`;
}

// Per-file staleness banner: the server compares each result file's on-disk
// (size, mtime) against its indexed stats and returns the changed ones, so the
// agent knows when line numbers may be shifted instead of trusting them blindly.
function staleBanner(staleFiles) {
  if (!Array.isArray(staleFiles) || !staleFiles.length) return "";
  const shown = staleFiles.slice(0, 5).join(", ");
  const more = staleFiles.length > 5 ? ` (+${staleFiles.length - 5} more)` : "";
  return `\n⚠ Changed on disk since the last index — line numbers may be shifted: ${shown}${more}. The graph re-indexes automatically; verify with Read if precision matters.`;
}

// Fenced, line-numbered verbatim source slice for a node (graph_node /
// graph_search include_source). Mirrors the numbering style of the Read tool
// so the agent can quote exact locations without opening the file.
function sourceBlock(node, source) {
  const lines = source.text.split("\n");
  const numbered = lines
    .map((line, i) => `${String(source.startLine + i).padStart(5)}\t${line}`)
    .join("\n");
  const trunc = source.truncated
    ? `\n  … truncated at line ${source.endLine} — Read ${node.filePath} for the rest.`
    : "";
  return `\`\`\`${node.language ?? ""}\n${numbered}\n\`\`\`${trunc}`;
}

function memoryLine(m) {
  const detail = m.body ? ` — ${m.body.replace(/\s+/g, " ").trim()}` : "";
  const conf = m.confidence && m.confidence !== "confirmed" ? ` (${m.confidence})` : "";
  return `- [${m.type}] ${m.title}${detail}${conf}  ·id:${m.id}`;
}

const server = new McpServer({ name: "recall", version: "0.1.0" });

// ─── Project memory (agent-driven save & recall) ─────────────────────────────

server.registerTool(
  "mem_save",
  {
    description:
      "Save a durable, typed fact about THIS project to Recall so future sessions start already knowing it. Use it right after a meaningful decision, discovery, convention, or gotcha. Keep it a one-line headline + a short detail (the why/where/how) — not a transcript. Deduped and injected into future session briefs automatically.",
    inputSchema: {
      type: z
        .enum(MEMORY_TYPES)
        .describe("Category: overview, stack, architecture, decision, convention, glossary, known-issue, preference, or discovery"),
      title: z.string().describe("One-line headline of the fact"),
      body: z.string().optional().describe("Optional short detail — the why / where / how"),
    },
  },
  ({ type, title, body }) =>
    runTool(async (projectId) => {
      try {
        const { memory, similar } = await apiPost(`/api/projects/${projectId}/memory`, {
          type,
          title,
          body,
          source: "agent",
          confidence: "inferred",
        });
        let text = `Saved to Recall: "${memory.title}" (${memory.type}). Future sessions on this project will see it.`;
        if (Array.isArray(similar) && similar.length) {
          text += `\n\nPossibly related existing memories — if one already covers this fact, merge with mem_update instead of keeping near-duplicates:\n${similar.map(memoryLine).join("\n")}`;
        }
        return textResult(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403")) {
          return errorResult("Agent memory writes are disabled for this project (Recall settings → Allow agents to write memories).");
        }
        throw err;
      }
    }),
);

server.registerTool(
  "mem_search",
  {
    description:
      "Search THIS project's Recall memory for curated facts by keyword (title/body/tags). Use it when you need prior project context — past decisions, conventions, known issues — that may not be in the current brief.",
    inputSchema: {
      query: z.string().describe("Keywords to search memory for"),
      limit: z.number().int().positive().max(50).optional().describe("Max results (default 20)"),
      match_mode: z
        .enum(["any", "all"])
        .optional()
        .describe("any = broad recall, ANY keyword may match (default); all = every keyword must match"),
    },
  },
  ({ query, limit, match_mode }) =>
    runTool(async (projectId) => {
      const qs = new URLSearchParams({ q: query });
      if (limit) qs.set("limit", String(limit));
      if (match_mode) qs.set("match", match_mode);
      const { memories } = await apiGet(`/api/projects/${projectId}/memory/search?${qs}`);
      if (!memories.length) return textResult(`No memories match "${query}".`);
      return textResult(`${memories.length} memory match(es) for "${query}":\n${memories.map(memoryLine).join("\n")}`);
    }),
);

server.registerTool(
  "mem_context",
  {
    description:
      "List THIS project's most relevant Recall memories (pinned + recent, optionally filtered by type) — a broad snapshot of what's been recorded about the project. Use it to orient beyond the startup brief.",
    inputSchema: {
      type: z.enum(MEMORY_TYPES).optional().describe("Optional: only memories of this category"),
      limit: z.number().int().positive().max(50).optional().describe("Max results (default 20)"),
    },
  },
  ({ type, limit }) =>
    runTool(async (projectId) => {
      const { memories } = await apiGet(`/api/projects/${projectId}/memory`);
      let list = memories;
      if (type) list = list.filter((m) => m.type === type);
      list = list.slice(0, limit ?? 20);
      if (!list.length) return textResult(type ? `No ${type} memories recorded yet.` : "No memories recorded yet.");
      return textResult(`${list.length} memory(ies):\n${list.map(memoryLine).join("\n")}`);
    }),
);

server.registerTool(
  "mem_update",
  {
    description:
      "Update an existing Recall memory (found via mem_search / mem_context — pass its id). Use this to correct or refine a fact instead of saving a near-duplicate.",
    inputSchema: {
      id: z.string().describe("The memory id (shown as ·id:… in mem_search / mem_context output)"),
      title: z.string().optional().describe("New headline"),
      body: z.string().optional().describe("New detail"),
      type: z.enum(MEMORY_TYPES).optional().describe("New category"),
    },
  },
  ({ id, title, body, type }) =>
    runTool(async (projectId) => {
      const patch = {};
      if (title !== undefined) patch.title = title;
      if (body !== undefined) patch.body = body;
      if (type !== undefined) patch.type = type;
      if (!Object.keys(patch).length) return errorResult("Nothing to update — pass at least one of title, body, or type.");
      // projectId pins the update to THIS session's project — a stale or
      // foreign id 404s server-side instead of mutating another project.
      const { memory } = await apiPatch(
        `/api/memory/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
        patch,
      );
      return textResult(`Updated memory "${memory.title}" (${memory.type}).`);
    }),
);

// ─── Code graph ──────────────────────────────────────────────────────────────

server.registerTool(
  "graph_search",
  {
    description:
      "Prefer this over grep/glob to find WHERE a function, class, method, interface, type, React component, or file is defined. This project is pre-indexed into a code graph, so a name/path lookup here is faster than scanning files and returns the most-connected (most central) matches first. Set include_source when you'll need the definition bodies too — the top matches come back with their verbatim source inline, skipping the follow-up file Read. Reach for it first when locating a symbol, then trace usage with get_neighbors / impact_of / shortest_path, or read one definition with graph_node.",
    inputSchema: {
      query: z.string().describe("Name or path substring to search for"),
      limit: z.number().int().positive().max(100).optional().describe("Max results (default 30)"),
      include_source: z
        .boolean()
        .optional()
        .describe("Include verbatim, line-numbered source for the top matches (skips a follow-up Read)"),
    },
  },
  ({ query, limit, include_source }) =>
    runTool(async (projectId) => {
      const qs = new URLSearchParams({ q: query });
      if (limit) qs.set("limit", String(limit));
      if (include_source) qs.set("source", "1");
      const { nodes, staleFiles } = await apiGet(`/api/projects/${projectId}/graph/search?${qs}`);
      if (!nodes.length) {
        const hint = await emptyGraphHint(projectId);
        return textResult(hint ?? `No symbols match "${query}".`);
      }
      const lines = nodes.map((n) => (n.source ? `${nodeLine(n)}\n${sourceBlock(n, n.source)}` : nodeLine(n)));
      return textResult(
        `${nodes.length} match(es) for "${query}":\n${lines.join("\n")}${staleBanner(staleFiles)}`,
      );
    }),
);

server.registerTool(
  "graph_node",
  {
    description:
      "Read a symbol's definition source straight from the code graph — verbatim and line-numbered — without opening the file. Prefer this over Read/grep when you need the body of ONE function, class, method, type, or component: pass its name (or file path / node id, as returned by graph_search) and get the exact lines back. Passing a file path returns the top of that file.",
    inputSchema: {
      node: z.string().describe("Symbol name, file path, or node id"),
    },
  },
  ({ node }) =>
    runTool(async (projectId) => {
      const qs = new URLSearchParams({ node });
      const res = await apiGet(`/api/projects/${projectId}/graph/node?${qs}`);
      const header = nodeLine(res.node).replace(/^- /, "");
      if (!res.source) {
        const hint = await emptyGraphHint(projectId);
        return textResult(
          hint ?? `${header}\n(source unavailable — the file may have moved since the last index; use Read on ${res.node.filePath})`,
        );
      }
      // Source is read live from disk; a stale index only shifts the range.
      const stale = res.stale
        ? `\n⚠ ${res.node.filePath} changed since the last index — the source above is live, but the symbol's line range may be shifted.`
        : "";
      return textResult(`${header}\n${sourceBlock(res.node, res.source)}${stale}`);
    }),
);

server.registerTool(
  "get_neighbors",
  {
    description:
      "List a symbol's direct graph neighbors: callers/callees (calls), importers/imports, and defines. Prefer this over grepping for call sites to answer 'what calls X' / 'what does X depend on' — the edges are indexed, so it's complete and instant. `direction` = 'in' (who points at it), 'out' (what it points at), or 'both'. Pass a symbol name, a file path, or a node id.",
    inputSchema: {
      node: z.string().describe("Symbol name, file path, or node id"),
      direction: z.enum(["in", "out", "both"]).optional().describe("Edge direction (default both)"),
    },
  },
  ({ node, direction }) =>
    runTool(async (projectId) => {
      const qs = new URLSearchParams({ node, direction: direction ?? "both" });
      const res = await apiGet(`/api/projects/${projectId}/graph/neighbors?${qs}`);
      const { node: center, neighbors } = res;
      if (!neighbors.length) {
        const hint = await emptyGraphHint(projectId);
        return textResult(hint ?? `${center.name} has no recorded neighbors.`);
      }
      const lines = neighbors.map((nb) => {
        const target = nb.node ? `${nb.node.name} (${nb.node.filePath}:${nb.node.startLine})` : nb.edge.dstName ?? "external";
        const arrow = nb.direction === "in" ? "←" : "→";
        return `- ${arrow} ${nb.edge.kind} [${nb.edge.confidence}] ${target}`;
      });
      return textResult(
        `${center.name} (${center.kind}) — ${center.filePath}:${center.startLine}\n${lines.join("\n")}${staleBanner(res.staleFiles)}`,
      );
    }),
);

server.registerTool(
  "shortest_path",
  {
    description:
      "Find a dependency path (imports/calls) between two symbols — 'how does A connect to B', a question grep can't answer. Returns the chain of symbols from `from` to `to`, or reports none within the search depth. Pass symbol names, file paths, or node ids.",
    inputSchema: {
      from: z.string().describe("Start symbol name, file path, or node id"),
      to: z.string().describe("End symbol name, file path, or node id"),
    },
  },
  ({ from, to }) =>
    runTool(async (projectId) => {
      const qs = new URLSearchParams({ from, to });
      const res = await apiGet(`/api/projects/${projectId}/graph/path?${qs}`);
      if (!res.found || !res.nodes.length) {
        return textResult(`No dependency path found from ${res.from.name} to ${res.to.name} within the search depth.`);
      }
      const chain = res.nodes.map((n) => `${n.name} (${n.filePath}:${n.startLine})`).join("\n  → ");
      return textResult(`Path (${res.nodes.length} hop(s)):\n  ${chain}${staleBanner(res.staleFiles)}`);
    }),
);

server.registerTool(
  "impact_of",
  {
    description:
      "Show what transitively depends on a symbol — 'what breaks if I change this'. Prefer this over grepping for usages before an edit: it returns the reverse-reachable dependents (callers and importers, several hops out), most-connected first. Pass a symbol name, file path, or node id.",
    inputSchema: {
      node: z.string().describe("Symbol name, file path, or node id"),
    },
  },
  ({ node }) =>
    runTool(async (projectId) => {
      const qs = new URLSearchParams({ node });
      const res = await apiGet(`/api/projects/${projectId}/graph/impact?${qs}`);
      if (!res.dependents.length) {
        const hint = await emptyGraphHint(projectId);
        return textResult(hint ?? `Nothing recorded as depending on ${res.node.name}.`);
      }
      const trunc = res.truncated ? " (truncated — many dependents)" : "";
      return textResult(
        `${res.dependents.length} dependent(s) of ${res.node.name}${trunc}:\n${res.dependents.map(nodeLine).join("\n")}${staleBanner(res.staleFiles)}`,
      );
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
