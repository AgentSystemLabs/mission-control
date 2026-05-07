import { listProjects, createProject, getProject, updateProject, deleteProject, togglePin, refreshBranch, ProjectCapExceededError } from "./services/projects";
import { initializeSkills, readSkillsStatus, SkillsBundleError } from "./services/skills-bundle";
import { listGroups, createGroup, updateGroup, deleteGroup } from "./services/groups";
import {
  listTasksForProject,
  createTask,
  updateStatus,
  archiveTask,
  restoreTask,
  updateTask,
  deleteTask,
  getTask,
} from "./services/tasks";
import {
  listUserTerminals,
  createUserTerminal,
  renameUserTerminal,
  deleteUserTerminal,
} from "./services/user-terminals";
import { events } from "./events";
import { getUsageSummary, syncTokenUsage } from "./services/token-usage";
import {
  getBooleanSetting,
  getOrCreateApiToken,
  getSetting,
  regenerateApiToken,
  setBooleanSetting,
  setSetting,
} from "~/db/settings";
import {
  DEFAULT_ACCENT_COLOR,
  isAccentColorId,
  type AccentColorId,
} from "~/lib/accent-colors";
import { getBindings, setBinding, resetBinding, resetAllBindings } from "~/db/keybindings";
import { HOTKEY_ACTIONS, type HotkeyAction } from "~/lib/keybindings/types";
import { isValidBinding } from "~/lib/keybindings/match";
import { json, jsonError, requireBearerToken } from "./auth";
import {
  readLicenseState,
  removeLicense,
  revalidateOnBoot,
  validateLicense,
} from "./services/license";
import { generateTitleForTask } from "./services/title-generator";
import { mapHookEventToStatus } from "~/shared/agent-hook-events";
import {
  getGitStatus,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commit as gitCommit,
  push as gitPush,
  gitErrorPayload,
  deleteProjectFile,
} from "./services/git";

const AGENT_HOOK_PATH = /^\/api\/hooks\/([a-z0-9-]+)$/;

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
        try {
          const p = createProject(body);
          return json({ project: p }, { status: 201 });
        } catch (e: any) {
          if (e instanceof ProjectCapExceededError) {
            return new Response(
              JSON.stringify({
                error: e.message,
                code: "free_tier_project_cap",
                limit: e.limit,
                current: e.current,
              }),
              { status: 402, headers: { "content-type": "application/json" } },
            );
          }
          throw e;
        }
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

    const projectFileMatch = pathname.match(
      /^\/api\/projects\/([^\/]+)\/file$/
    );
    if (projectFileMatch && method === "DELETE") {
      const id = decodeURIComponent(projectFileMatch[1]!);
      const filePath = url.searchParams.get("path");
      if (!filePath) return jsonError(400, "path is required");
      try {
        await deleteProjectFile(id, filePath);
        return json({ ok: true });
      } catch (e: any) {
        return jsonError(400, e?.message || "delete failed");
      }
    }

    const gitMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/git\/([a-z-]+)$/);
    if (gitMatch) {
      const id = decodeURIComponent(gitMatch[1]!);
      const action = gitMatch[2]!;
      try {
        if (action === "status" && method === "GET") {
          return json(await getGitStatus(id));
        }
        if (action === "diff" && method === "GET") {
          const file = url.searchParams.get("file");
          if (!file) return jsonError(400, "file is required");
          const stagedParam = url.searchParams.get("staged");
          const staged = stagedParam === "1" || stagedParam === "true";
          return json(await getGitDiff(id, file, staged));
        }
        if (action === "stage" && method === "POST") {
          const body = await readJson<{ files?: string[] }>(request);
          await stageFiles(id, body.files ?? []);
          return json({ ok: true });
        }
        if (action === "unstage" && method === "POST") {
          const body = await readJson<{ files?: string[] }>(request);
          await unstageFiles(id, body.files ?? []);
          return json({ ok: true });
        }
        if (action === "commit" && method === "POST") {
          const body = await readJson<{ autoStage?: boolean }>(request);
          return json(await gitCommit(id, { autoStage: body.autoStage }));
        }
        if (action === "push" && method === "POST") {
          return json(await gitPush(id));
        }
        return jsonError(404, "not found");
      } catch (e: any) {
        const payload = gitErrorPayload(e);
        return new Response(
          JSON.stringify({ error: payload.message, stderr: payload.stderr }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
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
          startCommand: body?.startCommand ?? null,
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

    if (pathname === "/api/settings") {
      const getAccentColorSetting = (): AccentColorId => {
        const value = getSetting("accent_color");
        return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
      };
      const settingsPayload = () => ({
        apiToken: getOrCreateApiToken(),
        agentSystemBannerDisabled: getBooleanSetting("agent_system_banner_disabled"),
        accentColor: getAccentColorSetting(),
      });
      if (method === "GET") {
        return json(settingsPayload());
      }
      if (method === "POST") {
        const body = await readJson<any>(request).catch(() => ({}));
        if ((body as any)?.regenerate) {
          const apiToken = regenerateApiToken();
          return json({ ...settingsPayload(), apiToken });
        }
        if (typeof body?.agentSystemBannerDisabled === "boolean") {
          setBooleanSetting("agent_system_banner_disabled", body.agentSystemBannerDisabled);
        }
        if (body?.accentColor !== undefined) {
          if (!isAccentColorId(body.accentColor)) return jsonError(400, "invalid accentColor");
          setSetting("accent_color", body.accentColor);
        }
        return json(settingsPayload());
      }
    }

    if (pathname === "/api/license") {
      if (method === "GET") {
        return json({ license: readLicenseState() });
      }
      if (method === "DELETE") {
        return json({ license: removeLicense() });
      }
    }

    if (pathname === "/api/license/validate" && method === "POST") {
      const body = await readJson<any>(request).catch(() => null);
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      if (!key) return jsonError(400, "key required");
      const license = await validateLicense(key);
      return json({ license });
    }

    if (pathname === "/api/license/revalidate" && method === "POST") {
      const license = await revalidateOnBoot();
      return json({ license });
    }

    if (pathname === "/api/skills") {
      if (method === "GET") return json(readSkillsStatus());
    }

    if (pathname === "/api/skills/initialize" && method === "POST") {
      try {
        const result = await initializeSkills();
        return json({ ...result, ...readSkillsStatus() });
      } catch (e: any) {
        if (e instanceof SkillsBundleError) {
          const status = e.code === "not_pro" || e.code === "no_key" ? 402 : 502;
          return new Response(
            JSON.stringify({ error: e.message, code: e.code }),
            { status, headers: { "content-type": "application/json" } },
          );
        }
        throw e;
      }
    }

    if (pathname === "/api/keybindings") {
      if (method === "GET") return json({ bindings: getBindings() });
      if (method === "PUT") {
        const body = await readJson<any>(request).catch(() => null);
        const action = body?.action as string | undefined;
        const binding = body?.binding;
        if (!action || !(HOTKEY_ACTIONS as readonly string[]).includes(action)) {
          return jsonError(400, "invalid action");
        }
        if (!binding || typeof binding !== "object") return jsonError(400, "binding required");
        const candidate = {
          mod: !!binding.mod,
          shift: !!binding.shift,
          alt: !!binding.alt,
          key: typeof binding.key === "string" ? binding.key : "",
        };
        const valid = isValidBinding(candidate);
        if (!valid.ok) return jsonError(400, valid.reason);
        return json({ bindings: setBinding(action as HotkeyAction, candidate) });
      }
      if (method === "DELETE") {
        const action = url.searchParams.get("action");
        if (action === null) return json({ bindings: resetAllBindings() });
        if (!(HOTKEY_ACTIONS as readonly string[]).includes(action)) {
          return jsonError(400, "invalid action");
        }
        return json({ bindings: resetBinding(action as HotkeyAction) });
      }
    }

    const agentHookMatch = pathname.match(AGENT_HOOK_PATH);
    if (agentHookMatch && method === "POST") {
      const auth = requireBearerToken(request);
      if (!auth.ok) return auth.response;
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return jsonError(400, "taskId required");
      const payload = await readJson<{
        hook_event_name?: string;
        prompt?: string;
        notification_type?: string;
        message?: string;
        title?: string;
      }>(request);
      const event = payload?.hook_event_name || "";
      const status = mapHookEventToStatus(payload);
      if (!status) return json({ ok: true, ignored: event });
      const t = updateStatus(taskId, { status });
      if (!t) return jsonError(404, "task not found");
      if (event === "UserPromptSubmit" && typeof payload?.prompt === "string" && payload.prompt.trim()) {
        // Fire-and-forget: don't block the hook response on CLI generation.
        void generateTitleForTask(taskId, payload.prompt);
      }
      return json({ ok: true, status });
    }

    if (pathname === "/api/usage" && method === "GET") {
      const daysParam = url.searchParams.get("days");
      const days = Math.max(
        1,
        Math.min(365, Number.parseInt(daysParam ?? "30", 10) || 30)
      );
      const skipSync = url.searchParams.get("sync") === "0";
      const ingested = skipSync ? 0 : await syncTokenUsage();
      const summary = getUsageSummary(days);
      return json({ ...summary, ingested });
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

export { mapHookEventToStatus } from "~/shared/agent-hook-events";

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
