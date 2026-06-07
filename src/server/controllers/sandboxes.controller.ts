import { z } from "zod";
import {
  deleteSandbox,
  getSandboxState,
  revealSandboxApiKey,
  setActiveScope,
  setSandboxesEnabled,
  updateSandbox,
} from "../services/sandboxes";
import {
  idParam,
  json,
  jsonError,
  noContent,
  notFound,
  parseJsonBody,
} from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";
import { MAX_TCP_PORT } from "~/shared/tcp-port";
import { isElectronLocalApiRequest } from "../request-runtime";

// Sandboxes are a local-desktop feature; hosted (web) requests get a disabled,
// empty state and cannot mutate.
const DISABLED_STATE = { sandboxes: [], enabled: false, activeScopeId: "local" } as const;

const updateBody = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().max(32).nullable(),
    imageTag: z.string().nullable(),
    dockerfilePath: z.string().nullable(),
    gitAuthMode: z.enum(["none", "copy-host", "generate"]),
    buildArgs: z.record(z.string(), z.string()).nullable(),
    declaredPorts: z.array(z.number().int().min(1).max(MAX_TCP_PORT)).nullable(),
  })
  .partial();

const activeBody = z.object({ scopeId: z.string().min(1) });
const enabledBody = z.object({ enabled: z.boolean() });

function localOnly(request: Request): Response | null {
  return isElectronLocalApiRequest(request)
    ? null
    : jsonError(HTTP_BAD_REQUEST, "Sandboxes are only available in the desktop app.");
}

export async function list(request: Request): Promise<Response> {
  if (!isElectronLocalApiRequest(request)) return json(DISABLED_STATE);
  return json(getSandboxState());
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const id = idParam.safeParse(rawId);
  if (!id.success) return notFound();
  const parsed = await parseJsonBody(request, updateBody);
  if (!parsed.ok) return parsed.response;
  const sandbox = updateSandbox(id.data, parsed.data);
  return sandbox ? json({ sandbox }) : notFound();
}

export async function revealApiKey(rawId: string, request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const id = idParam.safeParse(rawId);
  if (!id.success) return notFound();
  const apiKey = revealSandboxApiKey(id.data);
  return apiKey ? json({ apiKey }) : notFound();
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const id = idParam.safeParse(rawId);
  if (!id.success) return notFound();
  return deleteSandbox(id.data) ? noContent() : notFound();
}

export async function setActive(request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = await parseJsonBody(request, activeBody);
  if (!parsed.ok) return parsed.response;
  return json({ activeScopeId: setActiveScope(parsed.data.scopeId) });
}

export async function setEnabled(request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = await parseJsonBody(request, enabledBody);
  if (!parsed.ok) return parsed.response;
  setSandboxesEnabled(parsed.data.enabled);
  return json({ enabled: parsed.data.enabled });
}
