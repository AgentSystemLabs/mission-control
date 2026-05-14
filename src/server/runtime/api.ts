import { z } from "zod";
import { ensureApiTokenBootstrap } from "../bootstrap";
import { json, jsonError } from "../auth";
import { toApiErrorResponse } from "../lib/api-errors";
import { isCloudMode, requireAppAuth, requireCloudUser } from "../cloud/auth";
import { getProjectRow } from "../services/projects";
import { getTask } from "../services/tasks";
import { getUserTerminalProjectId } from "../services/user-terminals";
import type { CloudUser } from "../cloud/auth";
import { logger } from "~/shared/logger";
import {
  killRuntimePty,
  listRuntimeFiles,
  readRuntimeFile,
  replayRuntimePty,
  resizeRuntimePty,
  spawnRuntimePty,
  subscribeRuntimeEvents,
  getRuntimePtyProjectId,
  getRuntimeWorkspacePath,
  killRuntimeLaunchProcesses,
  unwatchRuntimeFile,
  watchRuntimeFile,
  writeRuntimeFile,
  writeRuntimePty,
} from "./daytona";

const ptySpawnSchema = z.object({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  subPath: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  agent: z.string().optional(),
  mcEnv: z.object({ apiUrl: z.string().optional(), token: z.string().optional() }).optional(),
});

const ptyIdSchema = z.object({ ptyId: z.string().min(1) });
const ptyWriteSchema = ptyIdSchema.extend({
  data: z.string(),
  projectId: z.string().min(1).optional(),
});
const ptyResizeSchema = ptyIdSchema.extend({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
const projectSchema = z.object({ projectId: z.string().min(1) });
const fileSchema = projectSchema.extend({ relPath: z.string().min(1) });
const fileWriteSchema = fileSchema.extend({
  content: z.string(),
  expectedMtimeMs: z.number().nullable().optional(),
});
const killLaunchProcessesSchema = z.object({
  projectId: z.string().min(1),
  commands: z.array(z.string()),
  ports: z.array(z.number().int().positive()).optional(),
});
const watchSchema = z.object({ watchId: z.string().min(1) });
const cliCheckSchema = z.object({ command: z.string().min(1) });
const MAX_RUNTIME_FILE_WRITE_BODY_BYTES = 6 * 1024 * 1024;

export async function handleRuntimeApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/runtime/")) return null;

  try {
  if (url.pathname === "/api/runtime/events") {
    const auth = await requireCloudUser(request);
    if (!auth.ok) return auth.response;
    return runtimeEventStream(auth.user);
  }

  if (
    url.pathname === "/api/runtime/client-token" &&
    request.method === "GET" &&
    !isCloudMode()
  ) {
    return json({ token: null });
  }
  if (
    url.pathname === "/api/runtime/user" &&
    request.method === "GET" &&
    !isCloudMode()
  ) {
    return json({ fullName: "User", firstName: "User" });
  }
  if (!isCloudMode()) {
    return jsonError(501, "cloud runtime is disabled in local desktop mode");
  }

  const auth = await requireAppAuth(request);
  if (!auth.ok) return auth.response;

    if (url.pathname === "/api/runtime/client-token" && request.method === "GET") {
      return json({ token: auth.user ? null : ensureApiTokenBootstrap() });
    }
    if (url.pathname === "/api/runtime/user" && request.method === "GET") {
      return json({
        fullName: auth.user?.email || auth.user?.id || "User",
        firstName: auth.user?.email?.split("@")[0] || auth.user?.id || "User",
      });
    }
    if (url.pathname === "/api/runtime/cli-check" && request.method === "POST") {
      const body = await parseBody(request, cliCheckSchema);
      if (!body.ok) return body.response;
      return json({ ok: true, path: body.data.command });
    }
    if (url.pathname === "/api/runtime/projects/path" && request.method === "POST") {
      const body = await parseBody(request, projectSchema);
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      const project = await getProjectRow(body.data.projectId);
      if (!project) return json({ ok: false, error: "unknown-project" });
      return json({ ok: true, path: await getRuntimeWorkspacePath(body.data.projectId) });
    }
    if (url.pathname === "/api/runtime/pty/spawn" && request.method === "POST") {
      const body = await parseBody(request, ptySpawnSchema);
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      const task = await getTask(body.data.taskId);
      const userTerminalProjectId = task ? null : await getUserTerminalProjectId(body.data.taskId);
      if (
        task
          ? task.projectId !== body.data.projectId
          : userTerminalProjectId !== body.data.projectId
      ) {
        return jsonError(403, "forbidden");
      }
      return json(await spawnRuntimePty(body.data));
    }
    if (url.pathname === "/api/runtime/pty/write" && request.method === "POST") {
      const body = await parseBody(request, ptyWriteSchema);
      if (!body.ok) return body.response;
      const access = await requirePtyAccess(body.data.ptyId, auth.user, body.data.projectId);
      if (!access.ok) return access.response;
      return json({
        ok: await writeRuntimePty(body.data.ptyId, body.data.data, access.projectId),
      });
    }
    if (url.pathname === "/api/runtime/pty/resize" && request.method === "POST") {
      const body = await parseBody(request, ptyResizeSchema);
      if (!body.ok) return body.response;
      const access = await requirePtyAccess(body.data.ptyId, auth.user);
      if (!access.ok) return access.response;
      return json({ ok: await resizeRuntimePty(body.data.ptyId, body.data.cols, body.data.rows) });
    }
    if (url.pathname === "/api/runtime/pty/kill" && request.method === "POST") {
      const body = await parseBody(request, ptyIdSchema);
      if (!body.ok) return body.response;
      const access = await requirePtyAccess(body.data.ptyId, auth.user);
      if (!access.ok) return access.response;
      return json({ ok: await killRuntimePty(body.data.ptyId) });
    }
    if (url.pathname === "/api/runtime/pty/replay" && request.method === "POST") {
      const body = await parseBody(request, ptyIdSchema);
      if (!body.ok) return body.response;
      const access = await requirePtyAccess(body.data.ptyId, auth.user);
      if (!access.ok) return access.response;
      return json({ data: replayRuntimePty(body.data.ptyId) });
    }
    if (url.pathname === "/api/runtime/pty/kill-launch-processes" && request.method === "POST") {
      const body = await parseBody(request, killLaunchProcessesSchema);
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      return json(await killRuntimeLaunchProcesses(body.data));
    }
    if (url.pathname === "/api/runtime/files/list" && request.method === "POST") {
      const body = await parseBody(request, projectSchema);
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      return json(await listRuntimeFiles(body.data.projectId));
    }
    if (url.pathname === "/api/runtime/files/read" && request.method === "POST") {
      const body = await parseBody(request, fileSchema);
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      return json(await readRuntimeFile(body.data.projectId, body.data.relPath));
    }
    if (url.pathname === "/api/runtime/files/write" && request.method === "POST") {
      const body = await parseBody(request, fileWriteSchema, {
        maxBytes: MAX_RUNTIME_FILE_WRITE_BODY_BYTES,
      });
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      return json(await writeRuntimeFile(
        body.data.projectId,
        body.data.relPath,
        body.data.content,
        body.data.expectedMtimeMs,
      ));
    }
    if (url.pathname === "/api/runtime/files/watch" && request.method === "POST") {
      const body = await parseBody(request, fileSchema);
      if (!body.ok) return body.response;
      const access = await requireProjectAccess(body.data.projectId, auth.user);
      if (!access.ok) return access.response;
      return json(watchRuntimeFile(body.data.projectId, body.data.relPath));
    }
    if (url.pathname === "/api/runtime/files/unwatch" && request.method === "POST") {
      const body = await parseBody(request, watchSchema);
      if (!body.ok) return body.response;
      return json(unwatchRuntimeFile(body.data.watchId));
    }
    return jsonError(404, "not found");
  } catch (err) {
    return toApiErrorResponse(err, { route: url.pathname, method: request.method });
  }
}

async function requireProjectAccess(projectId: string, user: CloudUser | null): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!user) return { ok: true };
  const project = await getProjectRow(projectId);
  if (project?.ownerUserId === user.id) return { ok: true };
  return { ok: false, response: jsonError(403, "forbidden") };
}

async function requirePtyAccess(
  ptyId: string,
  user: CloudUser | null,
  fallbackProjectId?: string,
): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const ptyProjectId = getRuntimePtyProjectId(ptyId);
  if (ptyProjectId && fallbackProjectId && fallbackProjectId !== ptyProjectId) {
    return { ok: false, response: jsonError(403, "forbidden") };
  }
  const projectId = ptyProjectId ?? fallbackProjectId ?? null;
  if (!projectId) return { ok: false, response: jsonError(404, "not found") };
  const access = await requireProjectAccess(projectId, user);
  if (!access.ok) return access;
  return { ok: true, projectId };
}

function runtimeEventStream(user: CloudUser): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: "ready" });
      unsubscribe = subscribeRuntimeEvents((event) => {
        if (!event.projectId) return;
        void (async () => {
          if (!(await requireProjectAccess(event.projectId, user)).ok) return;
          send(event);
        })().catch((err: unknown) => {
          logger.error("runtime event stream failed", {
            err,
            route: "/api/runtime/events",
            method: "GET",
          });
        });
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
  opts: { maxBytes?: number } = {},
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    const contentLength = request.headers.get("content-length");
    if (opts.maxBytes != null && contentLength != null) {
      const parsedLength = Number(contentLength);
      if (!Number.isFinite(parsedLength) || parsedLength > opts.maxBytes) {
        return { ok: false, response: jsonError(413, "request body is too large") };
      }
    }
    const text = await request.text();
    if (opts.maxBytes != null && Buffer.byteLength(text, "utf8") > opts.maxBytes) {
      return { ok: false, response: jsonError(413, "request body is too large") };
    }
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, "invalid json") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      response: jsonError(400, first ? `${first.path.join(".")}: ${first.message}` : "invalid body"),
    };
  }
  return { ok: true, data: parsed.data };
}
