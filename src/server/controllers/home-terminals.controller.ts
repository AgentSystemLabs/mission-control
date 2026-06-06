import { z } from "zod";
import {
  createHomeTerminal,
  deleteHomeTerminal,
  listHomeTerminals,
  renameHomeTerminal,
} from "../services/home-terminals";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";

const createHomeTerminalBody = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  cwd: z.string().nullable().optional(),
  scopeId: z.string().optional(),
});

const renameHomeTerminalBody = z.object({
  name: z.string().min(1, "name required"),
});

/**
 * Project-less "home" terminals only exist in the local (SQLite) runtime — the
 * desktop app and the local dev server. A hosted Postgres deployment has no
 * "local machine", so the feature is unavailable there (and must never touch the
 * SQLite client).
 */
function homeTerminalsAvailable(request: Request): boolean {
  if (isElectronLocalApiRequest(request)) return true;
  return !isHostedDatabaseEnabled();
}

export async function listAll(request: Request): Promise<Response> {
  if (!homeTerminalsAvailable(request)) return json({ terminals: [] });
  const scopeId = new URL(request.url).searchParams.get("scopeId");
  return json({ terminals: listHomeTerminals(scopeId) });
}

export async function create(request: Request): Promise<Response> {
  if (!homeTerminalsAvailable(request)) return notFound();
  const parsed = await parseJsonBody(request, createHomeTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const terminal = createHomeTerminal({
      id: parsed.data.id,
      name: parsed.data.name,
      cwd: parsed.data.cwd ?? null,
      scopeId: parsed.data.scopeId,
    });
    return json({ terminal }, { status: HTTP_CREATED });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function rename(rawId: string, request: Request): Promise<Response> {
  if (!homeTerminalsAvailable(request)) return notFound();
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, renameHomeTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const terminal = renameHomeTerminal(idParsed.data, parsed.data.name);
    if (!terminal) return notFound();
    return json({ terminal });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  if (!homeTerminalsAvailable(request)) return notFound();
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteHomeTerminal(parsed.data) ? noContent() : notFound();
}
