import { z } from "zod";
import {
  createWorktree,
  deleteWorktree,
  listWorktrees,
  worktreeErrorPayload,
} from "../services/worktrees";
import { handleDomainError, idParam, json, jsonError, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_CREATED, HTTP_FORBIDDEN } from "~/shared/http-status";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";

const deleteBody = z.object({
  force: z.boolean().optional(),
  stashChanges: z.boolean().optional(),
}).optional();

function booleanQueryFlag(url: URL, name: string): boolean | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function asWorktreeErrorResponse(e: unknown): Response {
  const payload = worktreeErrorPayload(e);
  return jsonError(payload.dirty ? HTTP_CONFLICT : HTTP_BAD_REQUEST, payload.stderr ?? payload.message);
}

async function rejectHostedWorktrees(request: Request): Promise<Response | null> {
  if (isElectronLocalApiRequest(request)) return null;
  if (!isHostedDatabaseEnabled()) return null;
  const hosted = await getHostedAuthContext(request);
  return hosted ? jsonError(HTTP_FORBIDDEN, "worktrees are only available for local projects") : null;
}

export async function list(rawProjectId: string, request: Request): Promise<Response> {
  const hosted = await rejectHostedWorktrees(request);
  if (hosted) return hosted;
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return notFound();
  try {
    return json({ worktrees: listWorktrees(parsed.data) });
  } catch (e) {
    return handleDomainError(e) ?? asWorktreeErrorResponse(e);
  }
}

export async function create(rawProjectId: string, request: Request): Promise<Response> {
  const hosted = await rejectHostedWorktrees(request);
  if (hosted) return hosted;
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return notFound();
  try {
    return json(await createWorktree(parsed.data), { status: HTTP_CREATED });
  } catch (e) {
    return handleDomainError(e) ?? asWorktreeErrorResponse(e);
  }
}

export async function remove(
  rawProjectId: string,
  rawWorktreeId: string,
  request: Request,
): Promise<Response> {
  const hosted = await rejectHostedWorktrees(request);
  if (hosted) return hosted;
  const projectId = idParam.safeParse(rawProjectId);
  const worktreeId = z.string().min(1).safeParse(rawWorktreeId);
  if (!projectId.success || !worktreeId.success) return notFound();
  const parsed = await parseJsonBody(request, deleteBody);
  if (!parsed.ok) return parsed.response;
  const url = new URL(request.url);
  try {
    const deleted = await deleteWorktree({
      projectId: projectId.data,
      worktreeId: worktreeId.data,
      force: parsed.data?.force ?? booleanQueryFlag(url, "force"),
      stashChanges: parsed.data?.stashChanges ?? booleanQueryFlag(url, "stashChanges"),
    });
    return deleted ? noContent() : notFound();
  } catch (e) {
    return handleDomainError(e) ?? asWorktreeErrorResponse(e);
  }
}
