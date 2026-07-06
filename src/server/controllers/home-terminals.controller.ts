import { z } from "zod";
import {
  createHomeTerminal,
  deleteHomeTerminal,
  listHomeTerminals,
  renameHomeTerminal,
} from "../services/home-terminals";
import { rethrowUnlessDomain, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";

const createHomeTerminalBody = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  cwd: z.string().nullable().optional(),
  scopeId: z.string().optional(),
});

const renameHomeTerminalBody = z.object({
  name: z.string().min(1, "name required"),
});

export async function listAll(request: Request): Promise<Response> {
  const scopeId = new URL(request.url).searchParams.get("scopeId");
  return json({ terminals: listHomeTerminals(scopeId) });
}

export async function create(request: Request): Promise<Response> {
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
    return rethrowUnlessDomain(e);
  }
}

export async function rename(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, renameHomeTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const terminal = renameHomeTerminal(idParsed.data, parsed.data.name);
    if (!terminal) return notFound();
    return json({ terminal });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteHomeTerminal(parsed.data) ? noContent() : notFound();
}
