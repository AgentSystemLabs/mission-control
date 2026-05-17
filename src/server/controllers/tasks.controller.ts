import { z } from "zod";
import { TASK_AGENTS, TASK_STATUSES } from "~/shared/domain";
import {
  archiveTask,
  createTask,
  deleteTask,
  getTask,
  listTasksForProject,
  restoreTask,
  updateStatus,
  updateTask,
} from "../services/tasks";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";

const createTaskBody = z.object({
  title: z.string().min(1, "title required"),
  agent: z.enum(TASK_AGENTS),
  branch: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  preview: z.string().optional(),
  claudeSessionId: z.string().nullable().optional(),
  claudeSkipPermissions: z.boolean().optional(),
  claudeBareSession: z.boolean().optional(),
});

const updateTaskBody = z
  .object({
    title: z.string(),
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
});

export function listForProject(rawProjectId: string): Response {
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return json({ tasks: [] });
  return json({ tasks: listTasksForProject(parsed.data) });
}

export async function create(rawProjectId: string, request: Request): Promise<Response> {
  const projectIdParsed = idParam.safeParse(rawProjectId);
  if (!projectIdParsed.success) return notFound();
  const parsed = await parseJsonBody(request, createTaskBody);
  if (!parsed.ok) return parsed.response;
  try {
    const t = createTask({ ...parsed.data, projectId: projectIdParsed.data });
    return json({ task: t }, { status: HTTP_CREATED });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export function getOne(rawId: string): Response {
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
    const t = updateTask(idParsed.data, parsed.data);
    if (!t) return notFound();
    return json({ task: t });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export function remove(rawId: string): Response {
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
    return json({ task: t });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export function archive(rawId: string): Response {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const t = archiveTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}

export function restore(rawId: string): Response {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const t = restoreTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}
