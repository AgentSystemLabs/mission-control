import { z } from "zod";
import {
  createUserTerminal,
  deleteUserTerminal,
  listUserTerminals,
  renameUserTerminal,
} from "../services/user-terminals";
import { handleDomainError, json, noContent, notFound, parseJsonBody } from "./_helpers";

const idParam = z.string().min(1);

const createTerminalBody = z.object({
  name: z.string().optional(),
  cwd: z.string().nullable().optional(),
  startCommand: z.string().nullable().optional(),
});

const renameTerminalBody = z.object({
  name: z.string().min(1, "name required"),
});

export function listForProject(rawProjectId: string): Response {
  const parsed = idParam.safeParse(rawProjectId);
  if (!parsed.success) return json({ terminals: [] });
  return json({ terminals: listUserTerminals(parsed.data) });
}

export async function create(rawProjectId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawProjectId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, createTerminalBody);
  if (!parsed.ok) return parsed.response;
  try {
    const t = createUserTerminal({
      projectId: idParsed.data,
      name: parsed.data.name,
      cwd: parsed.data.cwd ?? null,
      startCommand: parsed.data.startCommand ?? null,
    });
    return json({ terminal: t }, { status: 201 });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
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
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export function remove(rawId: string): Response {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteUserTerminal(parsed.data) ? noContent() : notFound();
}
