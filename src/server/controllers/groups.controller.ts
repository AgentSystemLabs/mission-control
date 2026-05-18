import { z } from "zod";
import { createGroup, deleteGroup, listGroups, updateGroup } from "../services/groups";
import {
  createHostedGroup,
  deleteHostedGroup,
  listHostedGroups,
  updateHostedGroup,
} from "../services/hosted-groups";
import { handleDomainError, idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_CREATED } from "~/shared/http-status";
import { getHostedAuthContext } from "../hosted-auth-context";
import { isHostedDatabaseEnabled } from "../hosted-pg";
import { isElectronLocalApiRequest } from "../request-runtime";

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

async function getHostedContext(request: Request) {
  if (isElectronLocalApiRequest(request)) return null;
  if (!isHostedDatabaseEnabled()) return null;
  return getHostedAuthContext(request);
}

export async function list(request: Request): Promise<Response> {
  const hosted = await getHostedContext(request);
  if (hosted) return json({ groups: await listHostedGroups(hosted) });
  return json({ groups: listGroups() });
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createGroupBody);
  if (!parsed.ok) return parsed.response;
  try {
    const hosted = await getHostedContext(request);
    if (hosted) {
      const g = await createHostedGroup(hosted, parsed.data);
      return json({ group: g }, { status: HTTP_CREATED });
    }
    const g = createGroup(parsed.data);
    return json({ group: g }, { status: HTTP_CREATED });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, updateGroupBody);
  if (!parsed.ok) return parsed.response;
  const hosted = await getHostedContext(request);
  if (hosted) {
    const g = await updateHostedGroup(hosted, idParsed.data, parsed.data);
    if (!g) return notFound();
    return json({ group: g });
  }
  const g = updateGroup(idParsed.data, parsed.data);
  if (!g) return notFound();
  return json({ group: g });
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const hosted = await getHostedContext(request);
  if (hosted) return (await deleteHostedGroup(hosted, parsed.data)) ? noContent() : notFound();
  return deleteGroup(parsed.data) ? noContent() : notFound();
}
