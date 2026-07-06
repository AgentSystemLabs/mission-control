import { z } from "zod";
import { SCRIPT_ARGS_MAX, TASK_AGENTS } from "~/shared/domain";
import {
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
  rethrowUnlessDomain,
  idParam,
  json,
  jsonError,
  noContent,
  notFound,
  parseJsonBody,
} from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_CREATED } from "~/shared/http-status";

const launchCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
});

const scriptArgSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "arg name must be a valid identifier"),
  description: z.string().max(200).optional(),
});

// Custom scripts are launch commands plus optional fill-in-the-blank args; the
// args field must be declared here or zod strips it from the persisted payload.
const customScriptSchema = launchCommandSchema.extend({
  args: z.array(scriptArgSchema).max(SCRIPT_ARGS_MAX).optional(),
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
    customScripts: z.array(customScriptSchema).nullable(),
    togglePin: z.literal(true).optional(),
  })
  .partial();

const reorderPinnedBody = z.object({
  order: z.array(z.string().min(1)),
});

export async function list(request: Request): Promise<Response> {
  return json({ projects: listProjects() });
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createProjectBody);
  if (!parsed.ok) return parsed.response;
  try {
    if (!parsed.data.path?.trim()) {
      return jsonError(HTTP_BAD_REQUEST, "path is required");
    }
    const localPath = parsed.data.path.trim();
    const { githubUrl: _ignored, ...localProject } = parsed.data;
    const p = createProject({ ...localProject, path: localPath });
    return json({ project: p }, { status: HTTP_CREATED });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function getOne(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const id = parsed.data;
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
  const status = getProjectPathStatus(parsed.data, worktreeId);
  return status ? json({ status }) : notFound();
}

export async function reorderPinned(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, reorderPinnedBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json({ projects: reorderPinnedProjects(parsed.data.order) });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
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
    return rethrowUnlessDomain(e);
  }
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteProject(parsed.data) ? noContent() : notFound();
}
