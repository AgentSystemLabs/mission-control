import { z } from "zod";
import { normalizeRemoteAgentUrl, SANDBOX_KINDS } from "~/shared/sandbox";
import {
  createSandbox,
  deleteSandbox,
  getSandboxState,
  revealSandboxApiKey,
  SandboxCapExceededError,
  setActiveScope,
  setSandboxesEnabled,
  updateSandbox,
} from "../services/sandboxes";
import { idParam, json, noContent, notFound, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_PAYMENT_REQUIRED } from "~/shared/http-status";
import { isElectronLocalApiRequest } from "../request-runtime";

// Sandboxes are a local-desktop feature; hosted (web) requests get a disabled,
// empty state and cannot mutate.
const DISABLED_STATE = { sandboxes: [], enabled: false, activeScopeId: "local" } as const;

const remoteAgentUrl = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => !!normalizeRemoteAgentUrl(value), {
    message: "Remote agent URL must use wss:// or https:// unless it is a localhost/private ws:// URL.",
  });

const remoteAgentUrlPatch = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => !!normalizeRemoteAgentUrl(value, { allowPlaintextPublic: true }), {
    message: "Remote agent URL must be a valid ws://, wss://, http://, or https:// URL.",
  });

const remoteApiKey = z.string().trim().min(16).max(512);

const createBody = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().max(32).nullable().optional(),
    kind: z.enum(SANDBOX_KINDS).optional(),
    remoteAgentUrl: remoteAgentUrl.optional(),
    apiKey: remoteApiKey.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "remote-vm") {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Docker sandboxes are no longer supported. Create an AWS project sandbox from a project page.",
      });
      return;
    }
    if (!value.remoteAgentUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["remoteAgentUrl"],
        message: "Remote agent URL is required for remote VM sandboxes.",
      });
    }
    if (!value.apiKey) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "API key is required for remote VM sandboxes.",
      });
    }
  });

const updateBody = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().max(32).nullable(),
    imageTag: z.string().nullable(),
    dockerfilePath: z.string().nullable(),
    gitAuthMode: z.enum(["none", "copy-host", "generate"]),
    buildArgs: z.record(z.string(), z.string()).nullable(),
    declaredPorts: z.array(z.number().int().min(1).max(65535)).nullable(),
    remoteAgentUrl: remoteAgentUrlPatch,
    apiKey: remoteApiKey,
  })
  .partial();

const activeBody = z.object({ scopeId: z.string().min(1) });
const enabledBody = z.object({ enabled: z.boolean() });

function localOnly(request: Request): Response | null {
  return isElectronLocalApiRequest(request)
    ? null
    : new Response(JSON.stringify({ error: "Sandboxes are only available in the desktop app." }), {
        status: HTTP_BAD_REQUEST,
        headers: { "content-type": "application/json" },
      });
}

export async function list(request: Request): Promise<Response> {
  if (!isElectronLocalApiRequest(request)) return json(DISABLED_STATE);
  return json(getSandboxState());
}

export async function create(request: Request): Promise<Response> {
  const blocked = localOnly(request);
  if (blocked) return blocked;
  const parsed = await parseJsonBody(request, createBody);
  if (!parsed.ok) return parsed.response;
  try {
    const sandbox = createSandbox(parsed.data);
    return json({ sandbox }, { status: HTTP_CREATED });
  } catch (e) {
    if (e instanceof SandboxCapExceededError) {
      return new Response(
        JSON.stringify({
          error: e.message,
          code: "free_tier_sandbox_cap",
          limit: e.limit,
          current: e.current,
        }),
        { status: HTTP_PAYMENT_REQUIRED, headers: { "content-type": "application/json" } },
      );
    }
    throw e;
  }
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
