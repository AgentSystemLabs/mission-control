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
  createHostedTask,
  deleteHostedTask,
  getHostedTask,
  listHostedTasksForProject,
  setHostedTaskArchived,
  updateHostedTask,
  updateHostedTaskStatus,
} from "../services/hosted-projects";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";
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
  prompt: z.string().optional(),
});

async function getHostedContext(request: Request) {
  if (isElectronLocalApiRequest(request)) return null;
  if (!isHostedDatabaseEnabled()) return null;
  return getHostedAuthContext(request);
}

export async function listForProject(rawProjectId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return json({ tasks: [] });
  const hosted = await getHostedContext(request);
  if (hosted) {
    return json({ tasks: await listHostedTasksForProject(hosted, parsed.data) });
  }
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
    const hosted = await getHostedContext(request);
    if (hosted) {
      const t = await createHostedTask(hosted, { ...parsed.data, projectId: projectIdParsed.data });
      return json({ task: t }, { status: HTTP_CREATED });
    }
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

function urlWorktreeId(request: Request): string | null | undefined {
  const value = new URL(request.url).searchParams.get("worktreeId");
  if (value === null) return undefined;
  return value && value !== "main" ? value : null;
}

function urlScopeId(request: Request): string {
  return new URL(request.url).searchParams.get("scopeId")?.trim() || LOCAL_SCOPE_ID;
}

export async function getOne(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const hosted = await getHostedContext(request);
  if (hosted) {
    const t = await getHostedTask(hosted, parsed.data);
    return t ? json({ task: t }) : notFound();
  }
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
    const hosted = await getHostedContext(request);
    if (hosted) {
      const t = await updateHostedTask(hosted, idParsed.data, parsed.data);
      if (!t) return notFound();
      return json({ task: t });
    }
    const t = updateTask(idParsed.data, parsed.data);
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
  const hosted = await getHostedContext(request);
  if (hosted) return (await deleteHostedTask(hosted, parsed.data)) ? noContent() : notFound();
  return deleteTask(parsed.data) ? noContent() : notFound();
}

export async function setStatus(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, updateStatusBody);
  if (!parsed.ok) return parsed.response;
  try {
    const hosted = await getHostedContext(request);
    if (hosted) {
      const t = await updateHostedTaskStatus(hosted, idParsed.data, parsed.data);
      if (!t) return notFound();
      return json({ task: t });
    }
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
  const hosted = await getHostedContext(request);
  if (hosted) {
    const t = await setHostedTaskArchived(hosted, parsed.data, true);
    if (!t) return notFound();
    return json({ task: t });
  }
  const t = archiveTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}

export async function restore(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const hosted = await getHostedContext(request);
  if (hosted) {
    const t = await setHostedTaskArchived(hosted, parsed.data, false);
    if (!t) return notFound();
    return json({ task: t });
  }
  const t = restoreTask(parsed.data);
  if (!t) return notFound();
  return json({ task: t });
}
