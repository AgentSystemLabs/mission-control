import { z } from "zod";
import { TASK_AGENTS } from "~/shared/domain";
import {
  ProjectCapExceededError,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  refreshBranch,
  togglePin,
  updateProject,
} from "../services/projects";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED, HTTP_PAYMENT_REQUIRED } from "~/shared/http-status";

const launchCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
});

const createProjectBody = z.object({
  name: z.string().optional(),
  path: z.string().min(1, "path is required"),
  icon: z.string().optional(),
  iconColor: z.string().optional(),
  groupId: z.string().nullable().optional(),
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
    rememberAgentSettings: z.boolean(),
    savedAgent: z.enum(TASK_AGENTS).nullable(),
    savedSkipPermissions: z.boolean(),
    savedBareSession: z.boolean(),
    launchCommands: z.array(launchCommandSchema).nullable(),
    togglePin: z.literal(true).optional(),
  })
  .partial();

export function list(): Response {
  return json({ projects: listProjects() });
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createProjectBody);
  if (!parsed.ok) return parsed.response;
  try {
    const p = createProject(parsed.data);
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

export function getOne(rawId: string): Response {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const id = parsed.data;
  const p = getProject(id);
  if (!p) return notFound();
  refreshBranch(id);
  return json({ project: p });
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const id = idParsed.data;
  const parsed = await parseJsonBody(request, updateProjectBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
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

export function remove(rawId: string): Response {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteProject(parsed.data) ? noContent() : notFound();
}
