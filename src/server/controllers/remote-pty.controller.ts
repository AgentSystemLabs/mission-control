import { z } from "zod";
import {
  HTTP_NOT_FOUND,
  HTTP_PAYMENT_REQUIRED,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
} from "~/shared/http-status";
import { json, jsonError, parseJsonBody } from "./_helpers";
import {
  consumeRemotePtyTicket,
  countActiveRemotePtys,
  issueRemotePtyTicket,
  killRemotePty,
  maxActiveRemotePtysPerScope,
  maxRetainedRemotePtyOutputBytes,
  remotePtyScopeKey,
  replayRemotePty,
  resizeRemotePty,
  remoteRuntimeDisabled,
  spawnRemotePty,
  subscribeRemotePty,
  writeRemotePty,
} from "../services/daytona-remote-pty";
import { getHostedAuthContext } from "../hosted-auth-context";
import { readEntitlements } from "../services/entitlements";
import { getHostedProject, getHostedTask } from "../services/hosted-projects";
import type { HostedAuthContext } from "../hosted-auth-context";
import { issueHostedHookToken, revokeHostedHookTokens } from "../services/hosted-hook-tokens";
import { logHostedEvent } from "../services/hosted-logs";
import { incrementHostedCounter } from "../services/hosted-metrics";
import { getHostedHookApiUrl } from "../services/remote-agent-hooks";
import { remotePtySpawnRateLimit, remotePtyWriteRateLimit } from "../services/rate-limits";
import { enforceHostedComputeLimit } from "../services/hosted-plan-limits";
import { ValidationError } from "../errors";

const ptyDimension = z.number().int();

const spawnBody = z.object({
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  cwd: z.string().min(1),
  command: z.string(),
  agent: z.string().optional(),
  cols: ptyDimension.optional(),
  rows: ptyDimension.optional(),
}).refine((body) => Number(!!body.taskId) + Number(!!body.projectId) === 1, {
  message: "exactly one of taskId or projectId is required",
});

const writeBody = z.object({
  data: z.string(),
});

const resizeBody = z.object({
  cols: ptyDimension,
  rows: ptyDimension,
});

function remoteRuntimeConfigurationError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const maybe = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = maybe.status ?? maybe.statusCode ?? maybe.response?.status;
  if (
    status === 401 ||
    status === 403 ||
    /invalid credentials/i.test(message) ||
    /DAYTONA_API_KEY is required/i.test(message)
  ) {
    return "Hosted remote runtime is misconfigured. Check DAYTONA_API_KEY and DAYTONA_API_URL.";
  }
  if (/fork\/exec .* no such file or directory/i.test(message)) {
    return `Hosted remote runtime could not start its shell. Check DAYTONA_PTY_SHELL for the sandbox image. ${message}`;
  }
  if (/PTY (?:login )?shell|configured PTY shell/i.test(message)) {
    return `Hosted remote runtime could not start its shell. Check DAYTONA_PTY_SHELL for the sandbox image. ${message}`;
  }
  return null;
}

async function requireRemoteRuntime(
  request: Request,
): Promise<{ ok: true; context: HostedAuthContext } | { ok: false; response: Response }> {
  if (remoteRuntimeDisabled()) {
    return {
      ok: false,
      response: jsonError(HTTP_SERVICE_UNAVAILABLE, "remote runtime disabled"),
    };
  }
  const context = await getHostedAuthContext(request);
  const entitlements = await readEntitlements(context);
  if (context && entitlements.remoteRuntime.allowed) return { ok: true, context };
  return {
    ok: false,
    response: jsonError(
      HTTP_UNAUTHORIZED,
      entitlements.remoteRuntime.reason ?? "remote runtime unavailable",
    ),
  };
}

export async function spawn(request: Request): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  const parsed = await parseJsonBody(request, spawnBody);
  if (!parsed.ok) return parsed.response;
  const spawnLimited = remotePtySpawnRateLimit(remotePtyScopeKey(authz.context));
  if (!spawnLimited.ok) return spawnLimited.response;
  if (countActiveRemotePtys(authz.context) >= maxActiveRemotePtysPerScope()) {
    return jsonError(HTTP_TOO_MANY_REQUESTS, "active remote terminal limit reached");
  }
  try {
    await enforceHostedComputeLimit(authz.context);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return jsonError(
      HTTP_PAYMENT_REQUIRED,
      `${error.message}. Open Academy billing to upgrade or wait for the usage window to reset.`,
    );
  }
  logHostedEvent("remote_pty.output_retention_policy", {
    maxRetainedOutputBytes: maxRetainedRemotePtyOutputBytes(),
  });
  let projectId = parsed.data.projectId ?? null;
  let hookEnv: { apiUrl: string; token: string } | null = null;
  let githubUrl: string | null = null;
  if (parsed.data.taskId) {
    const task = await getHostedTask(authz.context, parsed.data.taskId);
    if (!task) return jsonError(HTTP_NOT_FOUND, "task not found");
    projectId = task.projectId;
    const project = await getHostedProject(authz.context, projectId);
    if (!project) return jsonError(HTTP_NOT_FOUND, "project not found");
    githubUrl = project.githubUrl ?? null;
    const apiUrl = getHostedHookApiUrl();
    if (apiUrl) {
      const token = await issueHostedHookToken(authz.context, parsed.data.taskId);
      hookEnv = token ? { apiUrl, token } : null;
    } else {
      logHostedEvent(
        "remote_pty.hooks_skipped",
        {
          projectId,
          taskId: parsed.data.taskId,
          reason: "missing_public_url",
        },
        "warn",
      );
    }
    parsed.data.cwd = project.path;
  } else if (projectId) {
    const project = await getHostedProject(authz.context, projectId);
    if (!project) return jsonError(HTTP_NOT_FOUND, "project not found");
    githubUrl = project.githubUrl ?? null;
    parsed.data.cwd = project.path;
  }
  try {
    const result = await spawnRemotePty({
      ...parsed.data,
      projectId: projectId!,
      hookEnv,
      githubUrl,
      context: authz.context,
    });
    return json(result);
  } catch (error) {
    if (parsed.data.taskId && hookEnv) {
      await revokeHostedHookTokens(parsed.data.taskId).catch(() => undefined);
    }
    const runtimeConfigError = remoteRuntimeConfigurationError(error);
    if (runtimeConfigError) {
      logHostedEvent(
        "remote_pty.runtime_configuration_error",
        {
          projectId,
          taskId: parsed.data.taskId ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
      return jsonError(HTTP_SERVICE_UNAVAILABLE, runtimeConfigError);
    }
    throw error;
  }
}

export async function write(ptyId: string, request: Request): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  const parsed = await parseJsonBody(request, writeBody);
  if (!parsed.ok) return parsed.response;
  const writeLimited = remotePtyWriteRateLimit(remotePtyScopeKey(authz.context), ptyId);
  if (!writeLimited.ok) return writeLimited.response;
  const ok = await writeRemotePty(authz.context, ptyId, parsed.data.data);
  return ok ? json({ ok }) : jsonError(HTTP_NOT_FOUND, "pty not found");
}

export async function resize(ptyId: string, request: Request): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  const parsed = await parseJsonBody(request, resizeBody);
  if (!parsed.ok) return parsed.response;
  const ok = await resizeRemotePty(authz.context, ptyId, parsed.data.cols, parsed.data.rows);
  return ok ? json({ ok }) : jsonError(HTTP_NOT_FOUND, "pty not found");
}

export async function kill(ptyId: string, request: Request): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  const ok = await killRemotePty(authz.context, ptyId);
  return ok ? json({ ok }) : jsonError(HTTP_NOT_FOUND, "pty not found");
}

export async function replay(ptyId: string, request: Request): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  const url = new URL(request.url);
  const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
  const beforeSeq = Number(url.searchParams.get("beforeSeq") ?? Number.MAX_SAFE_INTEGER);
  const replay = replayRemotePty(authz.context, ptyId, { afterSeq, beforeSeq });
  return replay === null ? jsonError(HTTP_NOT_FOUND, "pty not found") : json(replay);
}

export async function ticket(ptyId: string, request: Request): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  const issued = issueRemotePtyTicket(authz.context, ptyId);
  return issued ? json(issued) : jsonError(HTTP_NOT_FOUND, "pty not found");
}

export async function stream(ptyId: string, request: Request, url: URL): Promise<Response> {
  const authz = await requireRemoteRuntime(request);
  if (!authz.ok) return authz.response;
  if (!consumeRemotePtyTicket(authz.context, ptyId, url.searchParams.get("ticket"))) {
    return jsonError(HTTP_UNAUTHORIZED, "unauthorized");
  }

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* connection closed */
        }
      };
      const subscription = subscribeRemotePty(ptyId, send);
      if (!subscription) {
        incrementHostedCounter("remotePtyFailures");
        logHostedEvent("remote_pty.stream_not_found", { ptyId }, "warn");
        send({ type: "error", error: "pty not found" });
        controller.close();
        return;
      }
      send({ type: "ready", ptyId, replayBeforeSeq: subscription.replayBeforeSeq });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* connection closed */
        }
      }, 15_000);
      cleanup = () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
