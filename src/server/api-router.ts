import { listProjects, createProject, getProject, updateProject, deleteProject, togglePin, refreshBranch } from "./services/projects";
import { listGroups, createGroup, updateGroup, deleteGroup } from "./services/groups";
import {
  listTasksForProject,
  createTask,
  updateStatus,
  archiveTask,
  restoreTask,
  updateTask,
  deleteTask,
  listAllArchived,
  getTask,
} from "./services/tasks";
import {
  listUserTerminals,
  createUserTerminal,
  renameUserTerminal,
  deleteUserTerminal,
} from "./services/user-terminals";
import { events } from "./events";
import { getOrCreateApiToken, regenerateApiToken } from "~/db/settings";
import { json, jsonError, requireBearerToken } from "./auth";

/** Pure Web `Request → Response` API router for `/api/*`. Reused in dev (Vite middleware) and prod. */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (!pathname.startsWith("/api/")) return null;

  try {
    if (pathname === "/api/projects") {
      if (method === "GET") return json({ projects: listProjects() });
      if (method === "POST") {
        const body = await readJson<any>(request);
        if (!body.path) return jsonError(400, "path is required");
        const p = createProject(body);
        return json({ project: p }, { status: 201 });
      }
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^\/]+)$/);
    if (projectMatch) {
      const id = decodeURIComponent(projectMatch[1]!);
      if (method === "GET") {
        const p = getProject(id);
        if (!p) return jsonError(404, "not found");
        refreshBranch(id);
        return json({ project: p });
      }
      if (method === "PATCH") {
        const body = await readJson<any>(request);
        if (body.togglePin === true) {
          const p = togglePin(id);
          if (!p) return jsonError(404, "not found");
          return json({ project: p });
        }
        const p = updateProject(id, body);
        if (!p) return jsonError(404, "not found");
        return json({ project: p });
      }
      if (method === "DELETE") {
        const ok = deleteProject(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    const projectTasksMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/tasks$/);
    if (projectTasksMatch) {
      const id = decodeURIComponent(projectTasksMatch[1]!);
      if (method === "GET") return json({ tasks: listTasksForProject(id) });
      if (method === "POST") {
        const auth = requireBearerToken(request);
        if (!auth.ok) return auth.response;
        const body = await readJson<any>(request);
        if (!body.title || !body.agent) return jsonError(400, "title and agent required");
        const t = createTask({ ...body, projectId: id });
        return json({ task: t }, { status: 201 });
      }
    }

    if (pathname === "/api/groups") {
      if (method === "GET") return json({ groups: listGroups() });
      if (method === "POST") {
        const body = await readJson<any>(request);
        if (!body.name) return jsonError(400, "name required");
        const g = createGroup(body);
        return json({ group: g }, { status: 201 });
      }
    }

    const groupMatch = pathname.match(/^\/api\/groups\/([^\/]+)$/);
    if (groupMatch) {
      const id = decodeURIComponent(groupMatch[1]!);
      if (method === "PATCH") {
        const body = await readJson<any>(request);
        const g = updateGroup(id, body);
        if (!g) return jsonError(404, "not found");
        return json({ group: g });
      }
      if (method === "DELETE") {
        const ok = deleteGroup(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^\/]+)$/);
    if (taskMatch) {
      const id = decodeURIComponent(taskMatch[1]!);
      if (method === "GET") {
        const t = getTask(id);
        if (!t) return jsonError(404, "not found");
        return json({ task: t });
      }
      if (method === "PATCH") {
        const body = await readJson<any>(request);
        const t = updateTask(id, body);
        if (!t) return jsonError(404, "not found");
        return json({ task: t });
      }
      if (method === "DELETE") {
        const ok = deleteTask(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/status$/);
    if (taskStatusMatch && method === "POST") {
      const auth = requireBearerToken(request);
      if (!auth.ok) return auth.response;
      const id = decodeURIComponent(taskStatusMatch[1]!);
      const body = await readJson<any>(request);
      const t = updateStatus(id, body);
      if (!t) return jsonError(404, "not found");
      return json({ task: t });
    }

    const taskArchiveMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/archive$/);
    if (taskArchiveMatch && method === "POST") {
      const id = decodeURIComponent(taskArchiveMatch[1]!);
      const t = archiveTask(id);
      if (!t) return jsonError(404, "not found");
      return json({ task: t });
    }

    const taskRestoreMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/restore$/);
    if (taskRestoreMatch && method === "POST") {
      const id = decodeURIComponent(taskRestoreMatch[1]!);
      const t = restoreTask(id);
      if (!t) return jsonError(404, "not found");
      return json({ task: t });
    }

    const projectUserTerminalsMatch = pathname.match(
      /^\/api\/projects\/([^\/]+)\/user-terminals$/
    );
    if (projectUserTerminalsMatch) {
      const id = decodeURIComponent(projectUserTerminalsMatch[1]!);
      if (method === "GET") return json({ terminals: listUserTerminals(id) });
      if (method === "POST") {
        const body = await readJson<any>(request);
        const t = createUserTerminal({
          projectId: id,
          name: body?.name,
          cwd: body?.cwd ?? null,
        });
        return json({ terminal: t }, { status: 201 });
      }
    }

    const userTerminalMatch = pathname.match(/^\/api\/user-terminals\/([^\/]+)$/);
    if (userTerminalMatch) {
      const id = decodeURIComponent(userTerminalMatch[1]!);
      if (method === "PATCH") {
        const body = await readJson<any>(request);
        if (typeof body?.name !== "string") return jsonError(400, "name required");
        const t = renameUserTerminal(id, body.name);
        if (!t) return jsonError(404, "not found");
        return json({ terminal: t });
      }
      if (method === "DELETE") {
        const ok = deleteUserTerminal(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    if (pathname === "/api/archive" && method === "GET") {
      return json({ tasks: listAllArchived() });
    }

    if (pathname === "/api/settings") {
      if (method === "GET") return json({ apiToken: getOrCreateApiToken() });
      if (method === "POST") {
        const body = await readJson<any>(request).catch(() => ({}));
        if ((body as any)?.regenerate) return json({ apiToken: regenerateApiToken() });
        return json({ apiToken: getOrCreateApiToken() });
      }
    }

    if (pathname === "/api/hooks/claude" && method === "POST") {
      const auth = requireBearerToken(request);
      if (!auth.ok) return auth.response;
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return jsonError(400, "taskId required");
      const payload = await readJson<{ hook_event_name?: string }>(request);
      const event = payload?.hook_event_name || "";
      const status = mapHookEventToStatus(event);
      if (!status) return json({ ok: true, ignored: event });
      const t = updateStatus(taskId, { status });
      if (!t) return jsonError(404, "task not found");
      return json({ ok: true, status });
    }

    if (pathname === "/api/events" && method === "GET") {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (data: unknown) => {
            try {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {
              /* swallow */
            }
          };
          send({ type: "hello", at: Date.now() });
          const off = events.onAny((e) => send(e));
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(enc.encode(": ping\n\n"));
            } catch {
              /* swallow */
            }
          }, 15_000);
          (controller as any)._mc_cleanup = () => {
            clearInterval(heartbeat);
            off();
          };
        },
        cancel() {
          const cleanup = (this as any)._mc_cleanup as undefined | (() => void);
          cleanup?.();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }

    return jsonError(404, "not found");
  } catch (err: any) {
    return jsonError(400, err?.message || "bad request");
  }
}

function mapHookEventToStatus(event: string): import("~/db/schema").TaskStatus | null {
  switch (event) {
    case "UserPromptSubmit":
      return "running";
    case "Stop":
    case "SubagentStop":
      return "finished";
    case "Notification":
    case "PermissionRequest":
      return "needs-input";
    default:
      return null;
  }
}

async function readJson<T>(request: Request): Promise<T> {
  if (!request.body) return {} as T;
  const text = await request.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
