import { z } from "zod";
import {
  createUserTerminal,
  deleteUserTerminal,
  listUserTerminals,
  listUserTerminalsForWorktree,
  renameUserTerminal,
} from "../services/user-terminals";
import {
  createHostedUserTerminal,
  deleteHostedUserTerminal,
  listHostedUserTerminals,
  renameHostedUserTerminal,
} from "../services/hosted-user-terminals";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";
import { getWorktree } from "../services/worktrees";

const createTerminalBody = z.object({
  name: z.string().optional(),
  cwd: z.string().nullable().optional(),
  startCommand: z.string().nullable().optional(),
  worktreeId: z.string().nullable().optional(),
});

const renameTerminalBody = z.object({
  name: z.string().min(1, "name required"),
});

async function getHostedContext(request: Request) {
  if (isElectronLocalApiRequest(request)) return null;
  if (!isHostedDatabaseEnabled()) return null;
  return getHostedAuthContext(request);
}

export async function listForProject(rawProjectId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return json({ terminals: [] });
  const hosted = await getHostedContext(request);
  if (hosted) {
    return json({ terminals: await listHostedUserTerminals(hosted, parsed.data) });
  }
  const worktreeId = urlWorktreeId(request);
  return json({
    terminals: worktreeId === undefined
      ? listUserTerminals(parsed.data)
      : listUserTerminalsForWorktree(parsed.data, worktreeId),
  });
}

export async function create(rawProjectId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawProjectId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, createTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const hosted = await getHostedContext(request);
    if (hosted) {
      const t = await createHostedUserTerminal(hosted, {
        projectId: idParsed.data,
        name: parsed.data.name,
        cwd: parsed.data.cwd ?? null,
        startCommand: parsed.data.startCommand ?? null,
      });
      return json({ terminal: t }, { status: HTTP_CREATED });
    }
    const worktree = getWorktree(idParsed.data, parsed.data.worktreeId ?? null);
    const t = createUserTerminal({
      projectId: idParsed.data,
      name: parsed.data.name,
      cwd: parsed.data.cwd ?? null,
      startCommand: parsed.data.startCommand ?? null,
      worktreeId: worktree.isMain ? null : worktree.id,
    });
    return json({ terminal: t }, { status: HTTP_CREATED });
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

export async function rename(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, renameTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const hosted = await getHostedContext(request);
    if (hosted) {
      const t = await renameHostedUserTerminal(hosted, idParsed.data, parsed.data.name);
      if (!t) return notFound();
      return json({ terminal: t });
    }
    const t = renameUserTerminal(idParsed.data, parsed.data.name);
    if (!t) return notFound();
    return json({ terminal: t });
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
  if (hosted) return (await deleteHostedUserTerminal(hosted, parsed.data)) ? noContent() : notFound();
  return deleteUserTerminal(parsed.data) ? noContent() : notFound();
}
