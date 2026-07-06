import { z } from "zod";
import {
  MEMORY_BODY_MAX,
  MEMORY_CONFIDENCES,
  MEMORY_SOURCES,
  MEMORY_TAG_MAX,
  MEMORY_TAGS_MAX,
  MEMORY_TITLE_MAX,
  MEMORY_TYPES,
} from "~/shared/project-memory";
import { LOCAL_SCOPE_ID, normalizeScopeId } from "~/shared/sandbox";
import {
  assembleSessionBrief,
  createMemory,
  deleteMemory,
  findSimilarMemories,
  listMemory,
  markMemoriesUsed,
  searchMemory,
  updateMemory,
  verifyMemory,
} from "../services/project-memory";
import { getTask } from "../services/tasks";
import { readRecallSettings } from "../services/recall-settings";
import { findProjectById } from "../repositories/projects.repo";
import { forbidden, handleDomainError, json, noContent, notFound, parseJsonBody, parseSearchParams } from "./_helpers";

const enumOf = <T extends string>(values: readonly T[]) =>
  z.enum(values as unknown as [T, ...T[]]);

const tagsSchema = z.array(z.string().trim().min(1).max(MEMORY_TAG_MAX)).max(MEMORY_TAGS_MAX);

const createBody = z.object({
  type: enumOf(MEMORY_TYPES),
  title: z.string().trim().min(1).max(MEMORY_TITLE_MAX),
  body: z.string().max(MEMORY_BODY_MAX).optional(),
  tags: tagsSchema.optional(),
  pinned: z.boolean().optional(),
  scopeId: z.string().optional(),
  confidence: enumOf(MEMORY_CONFIDENCES).optional(),
  source: enumOf(MEMORY_SOURCES).optional(),
  sourceTaskId: z.string().nullish(),
});

const updateBody = z
  .object({
    type: enumOf(MEMORY_TYPES).optional(),
    title: z.string().trim().min(1).max(MEMORY_TITLE_MAX).optional(),
    body: z.string().max(MEMORY_BODY_MAX).optional(),
    tags: tagsSchema.optional(),
    pinned: z.boolean().optional(),
    confidence: enumOf(MEMORY_CONFIDENCES).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

const listQuery = z.object({
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

const searchQuery = z.object({
  q: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? "", 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }),
  // `any` (OR terms, default — broad recall) vs `all` (every term must match).
  match: z.enum(["any", "all"]).optional(),
});

const deleteQuery = z.object({
  hard: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export async function list(projectId: string, url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, listQuery);
  if (!parsed.ok) return parsed.response;
  return json({ memories: listMemory(projectId, { includeArchived: parsed.data.includeArchived }) });
}

export async function search(projectId: string, url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, searchQuery);
  if (!parsed.ok) return parsed.response;
  return json({
    memories: searchMemory(projectId, parsed.data.q ?? "", parsed.data.limit, {
      matchMode: parsed.data.match,
    }),
  });
}

export async function create(projectId: string, request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createBody);
  if (!parsed.ok) return parsed.response;
  // Agent-written memories obey the agent-write toggle; user/voice writes don't.
  if (parsed.data.source === "agent" && !readRecallSettings().agentWriteEnabled) {
    return forbidden("agent memory writes are disabled");
  }
  try {
    const memory = createMemory({ projectId, ...parsed.data });
    // Near-duplicates the exact-title dedup can't catch, surfaced so the
    // caller (MCP tool, panel) can offer a merge/refine. Additive — existing
    // clients that only read `memory` are unaffected.
    const similar = findSimilarMemories(projectId, {
      title: memory.title,
      body: memory.body,
      scopeId: memory.scopeId,
      excludeId: memory.id,
    });
    return json({ memory, similar }, { status: 201 });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

/**
 * Optional `?projectId=` on the item routes: when present, the memory must
 * belong to that project (else 404). Project-aware callers (the MCP tools)
 * always send it so a stale/foreign id can't mutate another project's memory;
 * omitting it keeps the plain HTTP API backward compatible.
 */
function expectedProjectId(url: URL): string | undefined {
  return url.searchParams.get("projectId") ?? undefined;
}

export async function update(memoryId: string, request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, updateBody);
  if (!parsed.ok) return parsed.response;
  try {
    const opts = { expectedProjectId: expectedProjectId(new URL(request.url)) };
    return json({ memory: updateMemory(memoryId, parsed.data, opts) });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

/**
 * Preview the Session Brief a NEW session in this project would receive (default
 * scope, no task-title boost). Never records usage — it's a read-only preview
 * for the Recall panel's "what a new session will know" affordance.
 */
export async function previewBrief(projectId: string): Promise<Response> {
  const project = findProjectById(projectId);
  if (!project) return notFound("project not found");
  const scopeId = project.sandboxId ? normalizeScopeId(project.sandboxId) : LOCAL_SCOPE_ID;
  const { markdown, memoryIds } = assembleSessionBrief(projectId, scopeId);
  return json({ brief: markdown, memoryIds });
}

/**
 * The rendered Session Brief for a task's project/scope. Fetched by the Electron
 * main process at session spawn (before the agent starts) and written into the
 * agent's auto-load file. Marks the included memories as used. `record=false`
 * skips the usage bump (for previews like "view injected brief").
 */
export async function brief(taskId: string, url: URL): Promise<Response> {
  const task = getTask(taskId);
  if (!task) return notFound("task not found");
  const record = url.searchParams.get("record") !== "false";
  // Injection off → hand back an empty brief so the writer strips any stale
  // managed block on disk. Previews (record=false) still render for the panel.
  if (record && !readRecallSettings().injectBriefEnabled) {
    return json({ brief: "", memoryIds: [] });
  }
  const { markdown, memoryIds } = assembleSessionBrief(task.projectId, task.scopeId, {
    taskTitle: task.title,
    branch: task.branch,
  });
  if (record && memoryIds.length) markMemoriesUsed(memoryIds);
  return json({ brief: markdown, memoryIds });
}

/**
 * Verify a memory against the current code (Phase 3 hygiene). Runs the Recall
 * engine in the project's directory and applies the verdict server-side; returns
 * the verdict plus the resulting memory (a fresh head when contradicted).
 */
export async function verify(memoryId: string, url: URL): Promise<Response> {
  try {
    const { verdict, memory } = await verifyMemory(memoryId, {
      expectedProjectId: expectedProjectId(url),
    });
    return json({ verdict, memory });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function remove(memoryId: string, url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, deleteQuery);
  if (!parsed.ok) return parsed.response;
  try {
    deleteMemory(memoryId, { hard: parsed.data.hard, expectedProjectId: expectedProjectId(url) });
    return noContent();
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}
