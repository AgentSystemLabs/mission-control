import { z } from "zod";
import { TASK_AGENTS, TASK_STATUSES } from "~/shared/domain";
import {
  archiveTask,
  createTask,
  deleteTask,
  getTask,
  listTasksForProject,
  listTasksForProjectWorktree,
  restoreTask,
  updateStatus,
  updateTask,
} from "../services/tasks";
import {
  handleDomainError,
  idParam,
  json,
  noContent,
  notFound,
  parseJsonBody,
  urlScopeId,
  urlWorktreeId,
} from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";
import { getWorktree } from "../services/worktrees";
import { generateTitleForTask } from "../services/title-generator";
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

const createTaskBody = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1, "title required"),
  agent: z.enum(TASK_AGENTS),
  branch: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  preview: z.string().optional(),
  claudeSessionId: z.string().nullable().optional(),
  claudeSkipPermissions: z.boolean().optional(),
  claudeBareSession: z.boolean().optional(),
  worktreeId: z.string().nullable().optional(),
  scopeId: z.string().optional(),
});

const updateTaskBody = z
  .object({
    title: z.string().trim().min(1, "title required"),
    icon: z.string().nullable(),
    branch: z.string(),
    claudeSessionId: z.string().nullable(),
    claudeSkipPermissions: z.boolean(),
    claudeBareSession: z.boolean(),
  })
  .partial();

const updateStatusBody = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  preview: z.string().optional(),
  lines: z.number().optional(),
  prompt: z.string().optional(),
});

export async function listForProject(rawProjectId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return json({ tasks: [] });
  const worktreeId = urlWorktreeId(request);
  const scopeId = urlScopeId(request);
  try {
    return json({
      tasks: worktreeId === undefined
        ? listTasksForProject(parsed.data, scopeId)
        : listTasksForProjectWorktree(parsed.data, worktreeId, scopeId),
    });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function create(rawProjectId: string, request: Request): Promise<Response> {
  const projectIdParsed = idParam.safeParse(rawProjectId);
  if (!projectIdParsed.success) return notFound();
  const parsed = await parseJsonBody(request, createTaskBody);
  if (!parsed.ok) return parsed.response;
  try {
    const worktree = getWorktree(projectIdParsed.data, parsed.data.worktreeId ?? null);
    const t = createTask({
      ...parsed.data,
      projectId: projectIdParsed.data,
      worktreeId: worktree.isMain ? null : worktree.id,
      scopeId: parsed.data.scopeId ?? LOCAL_SCOPE_ID,
    });
    return json({ task: t }, { status: HTTP_CREATED });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function getOne(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const t = getTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, updateTaskBody);
  if (!parsed.ok) return parsed.response;
  try {
    const patch = Object.prototype.hasOwnProperty.call(parsed.data, "title")
      ? { ...parsed.data, titleManuallySet: true }
      : parsed.data;
    const t = updateTask(idParsed.data, patch);
    if (!t) return notFound();
    return json({ task: t });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteTask(parsed.data) ? noContent() : notFound();
}

export async function setStatus(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, updateStatusBody);
  if (!parsed.ok) return parsed.response;
  try {
    const t = updateStatus(idParsed.data, parsed.data);
    if (!t) return notFound();
    const prompt = typeof parsed.data.prompt === "string" ? parsed.data.prompt.trim() : "";
    if (prompt) {
      void generateTitleForTask(idParsed.data, prompt).catch(() => undefined);
    }
    return json({ task: t });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function archive(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const t = archiveTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}

export async function restore(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const t = restoreTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}
