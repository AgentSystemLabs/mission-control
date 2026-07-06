import { z } from "zod";
import {
  createUserTerminal,
  deleteUserTerminal,
  listUserTerminals,
  listUserTerminalsForWorktree,
  renameUserTerminal,
} from "../services/user-terminals";
import {
  rethrowUnlessDomain,
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
import { LOCAL_SCOPE_ID } from "~/shared/sandbox";

const createTerminalBody = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  cwd: z.string().nullable().optional(),
  startCommand: z.string().nullable().optional(),
  worktreeId: z.string().nullable().optional(),
  scopeId: z.string().optional(),
});

const renameTerminalBody = z.object({
  name: z.string().min(1, "name required"),
});

export async function listForProject(rawProjectId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return json({ terminals: [] });
  const worktreeId = urlWorktreeId(request);
  const scopeId = urlScopeId(request);
  try {
    return json({
      terminals: worktreeId === undefined
        ? listUserTerminals(parsed.data, scopeId)
        : listUserTerminalsForWorktree(parsed.data, worktreeId, scopeId),
    });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function create(rawProjectId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawProjectId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, createTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const worktree = getWorktree(idParsed.data, parsed.data.worktreeId ?? null);
    const t = createUserTerminal({
      id: parsed.data.id,
      projectId: idParsed.data,
      name: parsed.data.name,
      cwd: parsed.data.cwd ?? null,
      startCommand: parsed.data.startCommand ?? null,
      worktreeId: worktree.isMain ? null : worktree.id,
      scopeId: parsed.data.scopeId ?? LOCAL_SCOPE_ID,
    });
    return json({ terminal: t }, { status: HTTP_CREATED });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function rename(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, renameTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const t = renameUserTerminal(idParsed.data, parsed.data.name);
    if (!t) return notFound();
    return json({ terminal: t });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteUserTerminal(parsed.data) ? noContent() : notFound();
}
