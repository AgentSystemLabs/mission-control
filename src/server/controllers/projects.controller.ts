import { z } from "zod";
import { TASK_AGENTS } from "~/shared/domain";
import {
  ProjectCapExceededError,
  createProject,
  deleteProject,
  getProject,
  getProjectPathStatus,
  listProjects,
  refreshBranch,
  togglePin,
  updateProject,
  reorderPinnedProjects,
} from "../services/projects";
import {
  createHostedProject,
  deleteHostedProject,
  getHostedProject,
  listHostedProjects,
  toggleHostedProjectPin,
  updateHostedProject,
  reorderHostedPinnedProjects,
} from "../services/hosted-projects";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_PAYMENT_REQUIRED } from "~/shared/http-status";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";

const launchCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
});

const createProjectBody = z.object({
  name: z.string().optional(),
  path: z.string().optional(),
  githubUrl: z.string().optional(),
  icon: z.string().optional(),
  iconColor: z.string().optional(),
  groupId: z.string().nullable().optional(),
  sandboxId: z.string().nullable().optional(),
});

const updateProjectBody = z
  .object({
    name: z.string(),
    path: z.string(),
    icon: z.string(),
    iconColor: z.string(),
    imagePath: z.string().nullable(),
    groupId: z.string().nullable(),
    pinned: z.boolean(),
    branch: z.string(),
    launchUrl: z.string().nullable(),
    worktreeSetupCommand: z.string().max(500).nullable(),
    rememberAgentSettings: z.boolean(),
    savedAgent: z.enum(TASK_AGENTS).nullable(),
    savedSkipPermissions: z.boolean(),
    savedBareSession: z.boolean(),
    launchCommands: z.array(launchCommandSchema).nullable(),
    togglePin: z.literal(true).optional(),
  })
  .partial();

async function getHostedContext(request: Request) {
  if (isElectronLocalApiRequest(request)) return null;
  if (!isHostedDatabaseEnabled()) return null;
  return getHostedAuthContext(request);
}

const reorderPinnedBody = z.object({
  order: z.array(z.string().min(1)),
});

export async function list(request: Request): Promise<Response> {
  const hosted = await getHostedContext(request);
  if (hosted) return json({ projects: await listHostedProjects(hosted) });
  return json({ projects: listProjects() });
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createProjectBody);
  if (!parsed.ok) return parsed.response;
  try {
    const hosted = await getHostedContext(request);
    if (hosted) {
      const p = await createHostedProject(hosted, parsed.data);
      return json({ project: p }, { status: HTTP_CREATED });
    }
    if (!parsed.data.path?.trim()) {
      return new Response(JSON.stringify({ error: "path is required" }), {
        status: HTTP_BAD_REQUEST,
        headers: { "content-type": "application/json" },
      });
    }
    const localPath = parsed.data.path.trim();
    const { githubUrl: _ignored, ...localProject } = parsed.data;
    const p = createProject({ ...localProject, path: localPath });
    return json({ project: p }, { status: HTTP_CREATED });
  } catch (e) {
    if (e instanceof ProjectCapExceededError) {
      return new Response(
        JSON.stringify({
          error: e.message,
          code: "free_tier_project_cap",
          limit: e.limit,
          current: e.current,
        }),
        { status: HTTP_PAYMENT_REQUIRED, headers: { "content-type": "application/json" } },
      );
    }
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function getOne(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const id = parsed.data;
  const hosted = await getHostedContext(request);
  if (hosted) {
    const p = await getHostedProject(hosted, id);
    return p ? json({ project: p }) : notFound();
  }
  const p = getProject(id);
  if (!p) return notFound();
  refreshBranch(id);
  return json({ project: p });
}

export async function pathStatus(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const url = new URL(request.url);
  const worktreeId = url.searchParams.get("worktreeId");
  const hosted = await getHostedContext(request);
  if (hosted) {
    const p = await getHostedProject(hosted, parsed.data);
    return p ? json({ status: { ok: true, path: p.path, scope: "project" } }) : notFound();
  }
  const status = getProjectPathStatus(parsed.data, worktreeId);
  return status ? json({ status }) : notFound();
}

export async function reorderPinned(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, reorderPinnedBody);
  if (!parsed.ok) return parsed.response;
  try {
    const hosted = await getHostedContext(request);
    if (hosted) {
      return json({ projects: await reorderHostedPinnedProjects(hosted, parsed.data.order) });
    }
    return json({ projects: reorderPinnedProjects(parsed.data.order) });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const id = idParsed.data;
  const parsed = await parseJsonBody(request, updateProjectBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const hosted = await getHostedContext(request);
  if (hosted) {
    if (body.togglePin === true) {
      const pinned = await toggleHostedProjectPin(hosted, id);
      if (!pinned) return notFound();
      return json({ project: pinned });
    }
    const { togglePin: _ignored, ...patch } = body;
    try {
      const p = await updateHostedProject(hosted, id, patch);
      if (!p) return notFound();
      return json({ project: p });
    } catch (e) {
      const mapped = handleDomainError(e);
      if (mapped) return mapped;
      throw e;
    }
  }
  if (body.togglePin === true) {
    const pinned = togglePin(id);
    if (!pinned) return notFound();
    return json({ project: pinned });
  }
  const { togglePin: _ignored, ...patch } = body;
  try {
    const p = updateProject(id, patch);
    if (!p) return notFound();
    return json({ project: p });
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
  if (hosted) return (await deleteHostedProject(hosted, parsed.data)) ? noContent() : notFound();
  return deleteProject(parsed.data) ? noContent() : notFound();
}
