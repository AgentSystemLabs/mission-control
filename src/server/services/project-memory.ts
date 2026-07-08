import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";
import { MS_PER_DAY } from "~/shared/time-ms";
import {
  MEMORY_BODY_MAX,
  MEMORY_TITLE_MAX,
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  MEMORY_TYPE_WEIGHT,
  isMemoryConfidence,
  isMemoryStale,
  isMemoryType,
  parseMemoryTags,
  serializeMemoryTags,
  DEFAULT_MEMORY_CONFIDENCE,
  DEFAULT_MEMORY_SOURCE,
  type MemoryConfidence,
  type MemoryCreateInput,
  type MemorySource,
  type MemoryType,
  type MemoryUpdateInput,
  type MemoryVerifyVerdict,
  type MemoryView,
} from "~/shared/project-memory";
import type { ProjectMemory } from "~/db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { events } from "../events";
import { findProjectById } from "../repositories/projects.repo";
import {
  bumpMemoryUsage,
  deleteMemoryRow,
  findDuplicateByTitle,
  getMemoryById,
  insertMemoryRow,
  listBriefCandidates,
  listMemoryByProject,
  searchMemoryRanked,
  supersedeMemoryRow,
  updateMemoryRow,
  type MemoryMatchMode,
} from "../repositories/project-memory.repo";
import { verifyMemoryAgainstCode, type VerifyResult } from "./recall-engine";
import { getGraphStatus, getGraphSummary } from "./code-graph";
import { readRecallSettings } from "./recall-settings";
import { GRAPH_BRIEF_GOD_NODE_LIMIT } from "~/shared/code-graph";
import { newId } from "./_ids";

const MEMORY_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;

export function toMemoryView(row: ProjectMemory): MemoryView {
  return {
    id: row.id,
    projectId: row.projectId,
    scopeId: row.scopeId,
    type: row.type,
    title: row.title,
    body: row.body,
    tags: parseMemoryTags(row.tags),
    pinned: row.pinned,
    status: row.status,
    confidence: row.confidence,
    source: row.source,
    sourceTaskId: row.sourceTaskId,
    supersededById: row.supersededById,
    usageCount: row.usageCount,
    lastVerifiedAt: row.lastVerifiedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cleanTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new ValidationError("memory title is required");
  return trimmed.slice(0, MEMORY_TITLE_MAX);
}

function cleanBody(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, MEMORY_BODY_MAX);
}

/** Default a memory's scope to the project's sandbox scope (or Local). */
function resolveScope(projectSandboxId: string | null, requested?: string): string {
  if (requested) return normalizeScopeId(requested);
  return projectSandboxId ? normalizeScopeId(projectSandboxId) : LOCAL_SCOPE_ID;
}

export function listMemory(
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): MemoryView[] {
  return listMemoryByProject(projectId, opts).map(toMemoryView);
}

export function getMemory(id: string): MemoryView {
  const row = getMemoryById(id);
  if (!row) throw new NotFoundError("memory not found");
  return toMemoryView(row);
}

/**
 * Create a memory. If an active memory of the same type + title already exists
 * in the project, MERGE into it (refresh body/tags/confidence) instead of
 * inserting a duplicate — this keeps automatic capture from multiplying rows.
 */
export function createMemory(input: MemoryCreateInput): MemoryView {
  const project = findProjectById(input.projectId);
  if (!project) throw new NotFoundError("project not found");
  if (!isMemoryType(input.type)) throw new ValidationError("invalid memory type");

  const title = cleanTitle(input.title);
  const body = cleanBody(input.body);
  const tags = serializeMemoryTags(input.tags);
  const confidence = isMemoryConfidence(input.confidence)
    ? input.confidence
    : DEFAULT_MEMORY_CONFIDENCE;
  const now = Date.now();

  const dup = findDuplicateByTitle(input.projectId, input.type, title);
  if (dup) {
    const merged = updateMemoryRow(dup.id, {
      body: body || dup.body,
      tags: tags ?? dup.tags,
      confidence,
      updatedAt: now,
    });
    events.emit("memory:updated", { id: dup.id, projectId: input.projectId });
    return toMemoryView(merged ?? dup);
  }

  const id = newId("mem");
  insertMemoryRow({
    id,
    projectId: input.projectId,
    scopeId: resolveScope(project.sandboxId ?? null, input.scopeId),
    type: input.type,
    title,
    body,
    tags,
    pinned: input.pinned ?? false,
    status: "active",
    confidence,
    source: input.source ?? DEFAULT_MEMORY_SOURCE,
    sourceTaskId: input.sourceTaskId ?? null,
    supersededById: null,
    usageCount: 0,
    lastVerifiedAt: input.source === "manual" || input.source === undefined ? now : null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  events.emit("memory:created", { id, projectId: input.projectId });
  return getMemory(id);
}

/**
 * Ownership guard shared by the mutation paths. Callers that know which
 * project they are acting for (the MCP tools, project-scoped UI) pass
 * `expectedProjectId`; a memory belonging to another project then reads as
 * not-found rather than leaking or mutating cross-project state.
 */
export interface MemoryMutationOptions {
  expectedProjectId?: string;
}

function assertMemoryOwnership(row: ProjectMemory, opts?: MemoryMutationOptions): void {
  if (opts?.expectedProjectId && row.projectId !== opts.expectedProjectId) {
    throw new NotFoundError("memory not found");
  }
}

export function updateMemory(
  id: string,
  patch: MemoryUpdateInput,
  opts?: MemoryMutationOptions,
): MemoryView {
  const existing = getMemoryById(id);
  if (!existing) throw new NotFoundError("memory not found");
  assertMemoryOwnership(existing, opts);
  if (patch.type !== undefined && !isMemoryType(patch.type)) {
    throw new ValidationError("invalid memory type");
  }
  const next: Partial<ProjectMemory> = { updatedAt: Date.now() };
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.title !== undefined) next.title = cleanTitle(patch.title);
  if (patch.body !== undefined) next.body = cleanBody(patch.body);
  if (patch.tags !== undefined) next.tags = serializeMemoryTags(patch.tags);
  if (patch.pinned !== undefined) next.pinned = patch.pinned;
  if (patch.confidence !== undefined && isMemoryConfidence(patch.confidence)) {
    next.confidence = patch.confidence;
    next.lastVerifiedAt = Date.now();
  }
  if (patch.status !== undefined) next.status = patch.status;

  const updated = updateMemoryRow(id, next);
  events.emit("memory:updated", { id, projectId: existing.projectId });
  return toMemoryView(updated ?? existing);
}

/** The new fact that replaces a superseded one. Body/confidence/source optional. */
export interface MemorySupersedeInput {
  type?: MemoryType;
  title: string;
  body?: string;
  confidence?: MemoryConfidence;
  source?: MemorySource;
}

/**
 * Replace a memory with a corrected version, preserving history (Phase 3 D). A
 * new active head is inserted (carrying the old row's scope/pin/provenance) and
 * the old row is archived with `supersededById` pointing at the head — so the
 * brief and the panel show only the current fact while the chain stays auditable.
 * Used by the "verify against code" pass when the code contradicts a claim.
 */
export function supersedeMemory(oldId: string, input: MemorySupersedeInput): MemoryView {
  const old = getMemoryById(oldId);
  if (!old) throw new NotFoundError("memory not found");
  if (input.type !== undefined && !isMemoryType(input.type)) {
    throw new ValidationError("invalid memory type");
  }
  const title = cleanTitle(input.title);
  const body = cleanBody(input.body);
  const now = Date.now();
  const id = newId("mem");
  insertMemoryRow({
    id,
    projectId: old.projectId,
    scopeId: old.scopeId,
    type: input.type ?? old.type,
    title,
    body,
    tags: old.tags,
    pinned: old.pinned,
    status: "active",
    confidence: input.confidence ?? DEFAULT_MEMORY_CONFIDENCE,
    source: input.source ?? DEFAULT_MEMORY_SOURCE,
    sourceTaskId: old.sourceTaskId,
    supersededById: null,
    usageCount: 0,
    // The correction was just derived from the current code → count it verified.
    lastVerifiedAt: now,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  supersedeMemoryRow(oldId, id, now);
  events.emit("memory:updated", { id: oldId, projectId: old.projectId });
  events.emit("memory:created", { id, projectId: old.projectId });
  return getMemory(id);
}

/** Soft-delete (archive) by default; `hard` removes the row entirely. */
export function deleteMemory(
  id: string,
  opts: { hard?: boolean } & MemoryMutationOptions = {},
): void {
  const existing = getMemoryById(id);
  if (!existing) throw new NotFoundError("memory not found");
  assertMemoryOwnership(existing, opts);
  if (opts.hard) {
    deleteMemoryRow(id);
  } else {
    updateMemoryRow(id, { status: "archived", updatedAt: Date.now() });
  }
  events.emit("memory:deleted", { id, projectId: existing.projectId });
}

/**
 * Verify a memory's claim against the current repository via the Recall engine
 * (Phase 3 hygiene). Runs the engine pass in the project's own directory so the
 * CLI can read the code, then applies the verdict:
 *   - verified    → stamp `lastVerifiedAt`, promote confidence to `confirmed`.
 *   - stale       → downgrade to `ambiguous` (sinks in ranking, flagged for review).
 *   - contradicted→ supersede with the corrected fact + emit `memory:learned`.
 * Only runs for host-accessible Local projects with the engine on; otherwise a
 * `skipped` verdict is returned and nothing changes.
 */
export async function verifyMemory(
  id: string,
  opts?: MemoryMutationOptions,
): Promise<{ verdict: MemoryVerifyVerdict; memory: MemoryView }> {
  const existing = getMemoryById(id);
  if (!existing) throw new NotFoundError("memory not found");
  assertMemoryOwnership(existing, opts);
  const project = findProjectById(existing.projectId);
  if (!project) throw new NotFoundError("project not found");

  // Sandboxed projects store an in-container path we can't read on the host.
  const cwd = project.sandboxId ? null : project.path;
  const result: VerifyResult = cwd
    ? await verifyMemoryAgainstCode({
        memory: { type: existing.type, title: existing.title, body: existing.body },
        cwd,
      })
    : { verdict: "skipped" };

  const now = Date.now();
  if (result.verdict === "verified") {
    const updated = updateMemoryRow(id, {
      confidence: "confirmed",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    events.emit("memory:updated", { id, projectId: existing.projectId });
    return { verdict: "verified", memory: toMemoryView(updated ?? existing) };
  }
  if (result.verdict === "stale") {
    const updated = updateMemoryRow(id, { confidence: "ambiguous", updatedAt: now });
    events.emit("memory:updated", { id, projectId: existing.projectId });
    return { verdict: "stale", memory: toMemoryView(updated ?? existing) };
  }
  if (result.verdict === "contradicted") {
    const head = supersedeMemory(id, {
      type: existing.type,
      title: result.correctedTitle ?? existing.title,
      body: result.correctedBody ?? "",
      confidence: "inferred",
      source: "auto-distill",
    });
    // A contradicted fact + its correction land in the panel's Recently-learned
    // review filter via the same "learned" toast as auto-capture.
    events.emit("memory:learned", { projectId: existing.projectId, count: 1, sourceTaskId: null });
    return { verdict: "contradicted", memory: head };
  }
  return { verdict: "skipped", memory: toMemoryView(existing) };
}

export interface MemorySearchOptions {
  /** Restrict hits to these scopes (filtered in SQL, before any limit). */
  scopeIds?: readonly string[];
  /** `any` (OR terms, default) or `all` (every term must match). */
  matchMode?: MemoryMatchMode;
}

// Blended search ranking: text relevance dominates (bm25 normalized to 0–100,
// ×3), pinned gets a modest boost (deliberately NOT the brief's +1000 — a
// pinned weak match must not bury a strong unpinned one), and the shared
// metadata score (type/recency/usage/confidence/staleness) breaks ties.
const SEARCH_CANDIDATE_POOL = 50;
const SEARCH_TEXT_WEIGHT = 3;
const SEARCH_PINNED_BOOST = 50;
/** Neutral mid-range stand-in on the LIKE path, where there is no bm25 rank. */
const SEARCH_TEXT_FALLBACK = 50;

export function searchMemory(
  projectId: string,
  query: string,
  limit = MEMORY_SEARCH_LIMIT,
  opts: MemorySearchOptions = {},
): MemoryView[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || MEMORY_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
  const q = query.trim();
  if (!q) return listMemory(projectId).slice(0, capped);
  // Over-fetch so the re-rank sees more than the first page of text matches
  // (a stale memory can out-bm25 a fresher, more-used one by a hair).
  const ranked = searchMemoryRanked({
    projectId,
    query: q,
    limit: Math.max(capped, SEARCH_CANDIDATE_POOL),
    scopeIds: opts.scopeIds,
    matchMode: opts.matchMode,
  });
  if (!ranked.length) return [];
  const now = Date.now();
  // SQLite's bm25() is lower-is-better (negative); normalize to 0–100 higher-is-better.
  const maxAbs = Math.max(...ranked.map((r) => Math.abs(r.rank ?? 0)), 1e-9);
  return ranked
    .map(({ row, rank }) => {
      const view = toMemoryView(row);
      const text = rank === null ? SEARCH_TEXT_FALLBACK : (-rank / maxAbs) * 100;
      const score =
        SEARCH_TEXT_WEIGHT * text +
        (view.pinned ? SEARCH_PINNED_BOOST : 0) +
        memoryMetaScore(view, now);
      return { view, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, capped)
    .map((s) => s.view);
}

/**
 * Near-duplicates of a just-saved (or drafted) memory, for surfacing back to
 * the agent so it can merge/refine via mem_update instead of piling up
 * paraphrases the exact-title dedup can't catch. Reuses the blended search
 * with the memory's own title + body head as the query. Best-effort: any
 * failure returns [].
 */
const SIMILAR_MEMORY_LIMIT = 3;

export function findSimilarMemories(
  projectId: string,
  input: { title: string; body?: string; scopeId?: string; excludeId?: string; limit?: number },
): MemoryView[] {
  const limit = input.limit ?? SIMILAR_MEMORY_LIMIT;
  const query = `${input.title} ${(input.body ?? "").slice(0, 100)}`.trim();
  if (!query) return [];
  const scopeIds = input.scopeId
    ? [...new Set([normalizeScopeId(input.scopeId), LOCAL_SCOPE_ID])]
    : undefined;
  try {
    return searchMemory(projectId, query, limit + 1, { scopeIds })
      .filter((m) => m.id !== input.excludeId)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Candidate set for the Session Brief (ranking/budgeting done by the caller). */
export function briefCandidates(projectId: string, scopeId: string): MemoryView[] {
  return listBriefCandidates(projectId, normalizeScopeId(scopeId)).map(toMemoryView);
}

/** Record that a set of memories was included in a brief (feeds ranking/decay). */
export function markMemoriesUsed(ids: readonly string[]): void {
  bumpMemoryUsage(ids, Date.now());
}

// --- Session Brief assembly (deterministic ranker + budget + markdown) ---------

const BRIEF_CHAR_BUDGET = 2400;
const RECENCY_HALF_LIFE_MS = 30 * MS_PER_DAY;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Metadata-only relevance core shared by the brief ranker and blended search:
 * type weight + recency decay + usage + confidence, minus staleness. Pinned
 * and text/keyword relevance are deliberately NOT here — each caller weights
 * those very differently.
 */
export function memoryMetaScore(m: MemoryView, now: number): number {
  let score = MEMORY_TYPE_WEIGHT[m.type] ?? 0;
  // Recency decay from last use (or creation) — newer sinks slower.
  const ref = m.lastUsedAt ?? m.createdAt;
  const ageMs = Math.max(0, now - ref);
  score += 30 * Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
  score += Math.min(20, m.usageCount * 2);
  if (m.confidence === "confirmed") score += 10;
  else if (m.confidence === "ambiguous") score -= 10;
  // Staleness/decay feedback: memories that have gone long unverified and
  // unused sink so fresh, relevant facts aren't crowded out by aging ones.
  if (isMemoryStale(m, now)) score -= 25;
  return score;
}

function scoreMemory(m: MemoryView, now: number, keywords: Set<string>): number {
  let score = memoryMetaScore(m, now);
  if (m.pinned) score += 1000;
  if (keywords.size) {
    const hay = tokenize(`${m.title} ${m.body} ${m.tags.join(" ")}`);
    for (const k of keywords) {
      if (hay.has(k)) {
        score += 40;
        break;
      }
    }
  }
  return score;
}

export function renderMemoryLine(m: MemoryView): string {
  const body = m.body.trim().replace(/\s+/g, " ");
  const tag = m.confidence === "confirmed" ? "" : ` _(${m.confidence})_`;
  return body ? `- **${m.title}** — ${body}${tag}` : `- **${m.title}**${tag}`;
}

/**
 * The one-line "you have Recall MCP tools" nudge — drives adoption of both
 * pillars (memory save/recall + code-graph navigation). Included wherever the
 * brief renders so the agent knows the tools exist even before it uses them.
 */
const RECALL_TOOLS_NUDGE =
  "This project is indexed into a Recall code graph. When you need to find where something is defined, what calls it, or what a change would impact, reach for `graph_search` / `get_neighbors` / `impact_of` / `shortest_path` instead of grepping — the lookup is pre-indexed, ranked, and complete. `graph_node` (or `graph_search` with include_source) returns a symbol's verbatim source, so you can read a definition without opening the file. And save durable project facts as you learn them with `mem_save`; recall more with `mem_search` / `mem_context`.";

/**
 * "Architecture at a glance" — a compact orientation block from the code graph,
 * prepended to the brief so a session starts already understanding the shape of
 * the codebase. Returns null when there's no graph (or the feature is off), so a
 * memory-only brief renders unchanged. Strictly budgeted like the memory section.
 */
function renderArchitectureSection(projectId: string): string | null {
  if (!readRecallSettings().codeGraphEnabled) return null;
  const status = getGraphStatus(projectId);
  if (!status.indexed) return null;
  const summary = getGraphSummary(projectId);
  if (!summary.godNodes.length) return null;

  const lines: string[] = [
    "# Architecture at a glance (Mission Control code graph)",
    "",
    `Indexed ${status.fileCount.toLocaleString()} files, ${status.nodeCount.toLocaleString()} symbols, ${status.edgeCount.toLocaleString()} relationships. The most-connected modules — where core logic tends to live:`,
    "",
  ];
  for (const n of summary.godNodes.slice(0, GRAPH_BRIEF_GOD_NODE_LIMIT)) {
    lines.push(`- **${n.name}** — \`${n.filePath}:${n.startLine}\``);
  }
  if (summary.entryPoints.length) {
    const eps = summary.entryPoints.map((n) => `\`${n.filePath}\``).join(", ");
    lines.push("", `Entry points: ${eps}`);
  }
  lines.push("", RECALL_TOOLS_NUDGE);
  return lines.join("\n");
}

/**
 * Assemble the Session Brief for a project/scope within a character budget.
 * Leads with an "Architecture at a glance" block from the code graph (when
 * indexed), then the memory section: pinned + `overview`/`stack` are the
 * always-included core; the rest are chosen by a deterministic relevance score
 * (type weight + recency + usage + keyword match against the incoming task
 * title/branch). Returns the rendered markdown and the ids of the memories that
 * made it in (for usage tracking).
 */
export function assembleSessionBrief(
  projectId: string,
  scopeId: string,
  opts: { taskTitle?: string; branch?: string; budget?: number } = {},
): { markdown: string; memoryIds: string[] } {
  const archSection = renderArchitectureSection(projectId);
  const candidates = briefCandidates(projectId, scopeId);
  if (!candidates.length) {
    // A graph but no curated memories still yields an orientation brief.
    return archSection
      ? { markdown: archSection + "\n", memoryIds: [] }
      : { markdown: "", memoryIds: [] };
  }

  const now = Date.now();
  const keywords = tokenize(`${opts.taskTitle ?? ""} ${opts.branch ?? ""}`);
  const budget = opts.budget ?? BRIEF_CHAR_BUDGET;

  const core = candidates.filter((m) => m.pinned || m.type === "overview" || m.type === "stack");
  const coreIds = new Set(core.map((m) => m.id));
  const rest = candidates
    .filter((m) => !coreIds.has(m.id))
    .sort((a, b) => scoreMemory(b, now, keywords) - scoreMemory(a, now, keywords));

  const selected: MemoryView[] = [];
  let used = 0;
  for (const m of [...core, ...rest]) {
    const cost = renderMemoryLine(m).length + 1;
    // Core always goes in; the rest stop once the budget is exhausted.
    if (!coreIds.has(m.id) && used + cost > budget) continue;
    selected.push(m);
    used += cost;
  }

  const lines: string[] = [];
  if (archSection) lines.push(archSection, "");
  lines.push(
    "# Project memory (Mission Control Recall)",
    "",
    "Curated facts about this project, maintained by Mission Control so you don't have to rediscover it. Treat these as starting context and verify against the current code before relying on them.",
  );
  for (const type of MEMORY_TYPES) {
    const group = selected.filter((m) => m.type === type);
    if (!group.length) continue;
    lines.push("", `## ${MEMORY_TYPE_LABELS[type]}`);
    for (const m of group) lines.push(renderMemoryLine(m));
  }
  // The tools nudge already rides in the architecture section; add it here only
  // when there's no graph section (memory-only brief) so it's never duplicated.
  if (!archSection) lines.push("", RECALL_TOOLS_NUDGE);

  return { markdown: lines.join("\n") + "\n", memoryIds: selected.map((m) => m.id) };
}
