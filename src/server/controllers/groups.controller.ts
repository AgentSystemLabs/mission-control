import { z } from "zod";
import { createGroup, deleteGroup, listGroups, updateGroup } from "../services/groups";
import { rethrowUnlessDomain, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";

const createGroupBody = z.object({
  name: z.string().min(1, "name required"),
  color: z.string().optional(),
});

const updateGroupBody = z
  .object({
    name: z.string().min(1),
    color: z.string(),
  })
  .partial();

export async function list(request: Request): Promise<Response> {
  return json({ groups: listGroups() });
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createGroupBody);
  if (!parsed.ok) return parsed.response;
  try {
    const g = createGroup(parsed.data);
    return json({ group: g }, { status: HTTP_CREATED });
  } catch (e) {
    return rethrowUnlessDomain(e);
  }
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, updateGroupBody);
  if (!parsed.ok) return parsed.response;
  const g = updateGroup(idParsed.data, parsed.data);
  if (!g) return notFound();
  return json({ group: g });
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteGroup(parsed.data) ? noContent() : notFound();
}
