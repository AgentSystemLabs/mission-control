import { z } from "zod";
import { listProjects, createProject, getProject, updateProject, deleteProject, togglePin, refreshBranch, getProjectRow } from "./services/projects";
import { getErrorMessage } from "./lib/errors";
import { TASK_AGENTS, TASK_STATUSES } from "~/shared/domain";
import { initializeSkills, readSkillsStatus } from "./services/skills-bundle";
import {
  fetchLatestSkillsManifest,
  installProjectSkillsInRuntime,
  installProjectSkills,
  readInstalledSkillsVersionForProject,
} from "./services/install-skills";
import {
  createProjectFromLaunchKit,
  readLaunchKitAccess,
} from "./services/launch-kit";
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
  getUserTerminalProjectId,
} from "./services/user-terminals";
import { events } from "./events";
import { getUsageSummary, syncTokenUsage } from "./services/token-usage";
import {
  getBooleanSetting,
  getSetting,
  regenerateApiToken,
  setBooleanSetting,
  setSetting,
} from "./services/settings";
import {
  DEFAULT_ACCENT_COLOR,
  isAccentColorId,
  type AccentColorId,
} from "~/lib/accent-colors";
import { getBindings, setBinding, resetBinding, resetAllBindings } from "./services/keybindings";
import { HOTKEY_ACTIONS, type HotkeyAction } from "~/lib/keybindings/types";
import { isValidBinding } from "~/lib/keybindings/match";
import { json, jsonError, requireBearerToken, requireTokenQueryParam } from "./auth";
import { handleCloudAuthRequest, isCloudMode, requireAppAuth, type CloudUser } from "./cloud/auth";
import { clientKeyFromRequest, rateLimit, rateLimitResponse } from "./lib/rate-limit";
import {
  ensureLocalApiTokenBootstrap,
  refreshApiTokenAfterRegenerate,
} from "./bootstrap";
import { verifyTaskToken } from "./services/task-token";
import {
  readLicenseState,
  removeLicense,
  validateLicense,
} from "./services/license";
import {
  clearProjectImage,
  MAX_PROJECT_IMAGE_DATA_URL_LENGTH,
  normalizeProjectImageDataUrl,
} from "./services/project-images";
import { generateTitleForTask } from "./services/title-generator";
import { mapHookEventToStatus } from "~/shared/agent-hook-events";
import {
  getGitStatus,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commit as gitCommit,
  push as gitPush,
  deleteProjectFile,
} from "./services/git";
import { logger } from "~/shared/logger";
import { handleRuntimeApiRequest } from "./runtime/api";
import { toApiErrorResponse } from "./lib/api-errors";

const AGENT_HOOK_PATH = /^\/api\/hooks\/([a-z0-9-]+)$/;

/**
 * Show a native Electron confirm dialog before regenerating the API token.
 */
async function confirmTokenRegeneration(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as typeof import("electron") | undefined;
    const dialog = electron?.dialog;
    if (!dialog || typeof dialog.showMessageBox !== "function") {
      return true;
    }
    const result = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Cancel", "Regenerate"],
      defaultId: 0,
      cancelId: 0,
      title: "Regenerate API token?",
      message: "Regenerate the Mission Control API token?",
      detail: "This will invalidate all currently running agent sessions.",
    });
    return result.response === 1;
  } catch {
    return true;
  }
}

/**
 * Accept either the global API token or a per-task capability token whose
 * embedded taskId matches `requiredTaskId`. Used for endpoints a spawned
 * agent shell needs to reach.
 */
function requireTaskAuth(
  request: Request,
  requiredTaskId: string,
): { ok: true } | { ok: false; response: Response } {
  if (isCloudMode()) return { ok: false, response: jsonError(401, "unauthorized") };
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token.startsWith("v1.")) {
    const result = verifyTaskToken(token, requiredTaskId);
    if (result.ok) return { ok: true };
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return requireBearerToken(request);
}

async function canAccessProject(projectId: string, user: CloudUser | null): Promise<boolean> {
  if (!user) return true;
  const project = await getProjectRow(projectId);
  return !!project && project.ownerUserId === user.id;
}

async function canAccessTask(taskId: string, user: CloudUser | null): Promise<boolean> {
  if (!user) return true;
  const task = await getTask(taskId);
  return !!task && (await canAccessProject(task.projectId, user));
}

async function canAccessGroup(groupId: string, user: CloudUser | null): Promise<boolean> {
  if (!user) return true;
  const groups = await listGroups(user.id);
  return groups.some((group) => group.id === groupId);
}

async function canAccessUserTerminal(id: string, user: CloudUser | null): Promise<boolean> {
  if (!user) return true;
  const projectId = await getUserTerminalProjectId(id);
  return !!projectId && (await canAccessProject(projectId, user));
}

function projectIdFromEvent(event: { type: string; id?: string; projectId?: string }): string | null {
  if (event.projectId) return event.projectId;
  if (event.type.startsWith("project:") && event.id) return event.id;
  return null;
}

/** Pure Web `Request → Response` API router for `/api/*`. Reused in dev (Vite middleware) and prod. */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();
  const taskStatusMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/status$/);
  const agentHookMatch = pathname.match(AGENT_HOOK_PATH);

  if (!pathname.startsWith("/api/")) return null;

  try {
  if (pathname === "/api/runtime/mode" && method === "GET") {
    return json({ cloudMode: isCloudMode() });
  }

  if (pathname.startsWith("/api/auth/")) {
    if (!isCloudMode()) return jsonError(404, "not found");
    return handleCloudAuthRequest(request);
  }

  // Lazy bootstrap so test files that import this module without
  // triggering a real request don't force DB initialization.
  ensureLocalApiTokenBootstrap();

  const runtimeResponse = await handleRuntimeApiRequest(request);
  if (runtimeResponse) return runtimeResponse;
  let authenticatedUser: CloudUser | null = null;

  // Top-level auth gate. SSE uses ?t=<token> because EventSource can't set
  // headers; everything else requires Authorization: Bearer <token>.
  // Subprocess hooks (`/api/hooks/:slug`, `/api/tasks/:id/status`) attach
  // the same bearer via env, so this single check covers them too.
  if (pathname === "/api/events") {
    if (isCloudMode()) {
      const appAuth = await requireAppAuth(request);
      if (!appAuth.ok) return appAuth.response;
      authenticatedUser = appAuth.user;
    } else {
      const auth = requireTokenQueryParam(url);
      if (!auth.ok) return auth.response;
    }
  } else if (taskStatusMatch && method === "POST") {
    const taskId = decodeURIComponent(taskStatusMatch[1]!);
    const auth = requireTaskAuth(request, taskId);
    if (!auth.ok) {
      const appAuth = await requireAppAuth(request);
      if (!appAuth.ok) return auth.response;
      authenticatedUser = appAuth.user;
      if (!(await canAccessTask(taskId, authenticatedUser))) return jsonError(403, "forbidden");
    }
  } else if (agentHookMatch && method === "POST") {
    const taskId = url.searchParams.get("taskId");
    if (!taskId) return jsonError(400, "taskId required");
    const auth = requireTaskAuth(request, taskId);
    if (!auth.ok) return auth.response;
  } else {
    const auth = await requireAppAuth(request);
    if (!auth.ok) return auth.response;
    authenticatedUser = auth.user;
  }

  try {
    if (pathname === "/api/projects") {
      if (method === "GET") {
        const rows = await listProjects(authenticatedUser?.id ?? null);
        return json({
          projects: rows,
        });
      }
      if (method === "POST") {
        const parsed = await parseBody(request, createProjectBodySchema, {
          maxBytes: PROJECT_IMAGE_JSON_BODY_MAX_BYTES,
        });
        if (!parsed.ok) return parsed.response;
        if (parsed.data.groupId && !(await canAccessGroup(parsed.data.groupId, authenticatedUser))) {
          return jsonError(403, "forbidden");
        }
        if (!authenticatedUser && !parsed.data.path?.trim()) {
          return jsonError(400, "path is required");
        }
        if (authenticatedUser && !parsed.data.repoUrl?.trim()) {
          return jsonError(400, "Git repository URL is required in cloud mode");
        }
        if (parsed.data.imageDataUrl !== undefined) {
          const rl = rateLimit("project-image", authenticatedUser?.id ?? clientKeyFromRequest(request), {
            max: 20,
            windowMs: 60 * 1000,
          });
          if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
        }
        try {
          const imageDataUrl =
            parsed.data.imageDataUrl !== undefined
              ? normalizeProjectImageDataUrl(parsed.data.imageDataUrl)
              : undefined;
          const p = await createProject({
            ...parsed.data,
            imageDataUrl,
            ownerUserId: authenticatedUser?.id ?? null,
            runtimeKind: authenticatedUser ? "daytona" : "local",
          });
          logger.info("project created", {
            op: "create_project",
            projectId: p.id,
            userId: authenticatedUser?.id ?? null,
            runtimeKind: p.runtimeKind,
            hasRepoUrl: Boolean(p.repoUrl),
          });
          return json({ project: p }, { status: 201 });
        } catch (e: unknown) {
          return toApiErrorResponse(e, { route: pathname, method });
        }
      }
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const id = decodeURIComponent(projectMatch[1]!);
      if (!(await canAccessProject(id, authenticatedUser))) return jsonError(403, "forbidden");
      if (method === "GET") {
        const p = await getProject(id);
        if (!p) return jsonError(404, "not found");
        await refreshBranch(id);
        return json({ project: p });
      }
      if (method === "PATCH") {
        const parsed = await parseBody(request, updateProjectBodySchema, {
          maxBytes: PROJECT_IMAGE_JSON_BODY_MAX_BYTES,
        });
        if (!parsed.ok) return parsed.response;
        if (parsed.data.togglePin === true) {
          const p = await togglePin(id);
          if (!p) return jsonError(404, "not found");
          return json({ project: p });
        }
        const { togglePin: _ignored, ...patch } = parsed.data;
        if (authenticatedUser && patch.path !== undefined) {
          return jsonError(400, "path is local-only");
        }
        if (patch.groupId && !(await canAccessGroup(patch.groupId, authenticatedUser))) {
          return jsonError(403, "forbidden");
        }
        if (patch.imageDataUrl !== undefined) {
          const rl = rateLimit("project-image", authenticatedUser?.id ?? clientKeyFromRequest(request), {
            max: 20,
            windowMs: 60 * 1000,
          });
          if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
        }
        const projectScope = authenticatedUser ? { userId: authenticatedUser.id } : undefined;
        let imageDataUrl: string | null | undefined;
        try {
          imageDataUrl =
            patch.imageDataUrl !== undefined
              ? normalizeProjectImageDataUrl(patch.imageDataUrl)
              : undefined;
        } catch (e: unknown) {
          return toApiErrorResponse(e, {
            route: pathname,
            method,
            fallbackStatus: 400,
            fallbackMessage: "Invalid project image",
            fallbackCode: "invalid_project_image",
          });
        }
        const { imagePath, imageDataUrl: _ignoredImageDataUrl, ...rest } = patch;
        const existingProject = await getProjectRow(id);
        if (!existingProject) return jsonError(404, "not found");
        if (existingProject.runtimeKind !== "local" && imagePath !== undefined) {
          return jsonError(400, "imagePath is local-only");
        }
        if (imagePath && imageDataUrl) {
          return jsonError(400, "Choose either a local image path or image data URL");
        }
        let p =
          Object.keys(rest).length > 0
            ? await updateProject(id, rest, projectScope)
            : existingProject;
        if (!p) return jsonError(404, "not found");
        if (imagePath === null) {
          p = await clearProjectImage(id);
          if (p) p = await updateProject(id, { imageDataUrl: null }, projectScope);
        } else if (imagePath !== undefined) {
          p = await updateProject(id, { imagePath, imageDataUrl: null }, projectScope);
        }
        if (imageDataUrl !== undefined) {
          p = await updateProject(id, { imageDataUrl }, projectScope);
        }
        if (!p) return jsonError(404, "not found");
        return json({ project: p });
      }
      if (method === "DELETE") {
        const ok = await deleteProject(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    const projectTasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
    if (projectTasksMatch) {
      const id = decodeURIComponent(projectTasksMatch[1]!);
      if (!(await canAccessProject(id, authenticatedUser))) return jsonError(403, "forbidden");
      if (method === "GET") return json({ tasks: await listTasksForProject(id) });
      if (method === "POST") {
        const parsed = await parseBody(request, createTaskBodySchema);
        if (!parsed.ok) return parsed.response;
        const t = await createTask({ ...parsed.data, projectId: id });
        return json({ task: t }, { status: 201 });
      }
    }

    if (pathname === "/api/groups") {
      if (method === "GET") return json({ groups: await listGroups(authenticatedUser?.id ?? null) });
      if (method === "POST") {
        const parsed = await parseBody(request, createGroupBodySchema);
        if (!parsed.ok) return parsed.response;
        const g = await createGroup({
          ...parsed.data,
          ownerUserId: authenticatedUser?.id ?? null,
        });
        return json({ group: g }, { status: 201 });
      }
    }

    const groupMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
    if (groupMatch) {
      const id = decodeURIComponent(groupMatch[1]!);
      if (!(await canAccessGroup(id, authenticatedUser))) return jsonError(403, "forbidden");
      if (method === "PATCH") {
        const parsed = await parseBody(request, updateGroupBodySchema);
        if (!parsed.ok) return parsed.response;
        const g = await updateGroup(id, parsed.data, authenticatedUser?.id ?? null);
        if (!g) return jsonError(404, "not found");
        return json({ group: g });
      }
      if (method === "DELETE") {
        const ok = await deleteGroup(id, authenticatedUser?.id ?? null);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const id = decodeURIComponent(taskMatch[1]!);
      if (!(await canAccessTask(id, authenticatedUser))) return jsonError(403, "forbidden");
      if (method === "GET") {
        const t = await getTask(id);
        if (!t) return jsonError(404, "not found");
        return json({ task: t });
      }
      if (method === "PATCH") {
        const parsed = await parseBody(request, updateTaskBodySchema);
        if (!parsed.ok) return parsed.response;
        const t = await updateTask(id, parsed.data);
        if (!t) return jsonError(404, "not found");
        return json({ task: t });
      }
      if (method === "DELETE") {
        const ok = await deleteTask(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    if (taskStatusMatch && method === "POST") {
      const id = decodeURIComponent(taskStatusMatch[1]!);
      const auth = requireTaskAuth(request, id);
      if (!auth.ok && !(await canAccessTask(id, authenticatedUser))) return auth.response;
      const parsed = await parseBody(request, taskStatusBodySchema);
      if (!parsed.ok) return parsed.response;
      const t = await updateStatus(id, parsed.data);
      if (!t) return jsonError(404, "not found");
      return json({ task: t });
    }

    const taskArchiveMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
    if (taskArchiveMatch && method === "POST") {
      const id = decodeURIComponent(taskArchiveMatch[1]!);
      if (!(await canAccessTask(id, authenticatedUser))) return jsonError(403, "forbidden");
      const t = await archiveTask(id);
      if (!t) return jsonError(404, "not found");
      return json({ task: t });
    }

    const taskRestoreMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/restore$/);
    if (taskRestoreMatch && method === "POST") {
      const id = decodeURIComponent(taskRestoreMatch[1]!);
      if (!(await canAccessTask(id, authenticatedUser))) return jsonError(403, "forbidden");
      const t = await restoreTask(id);
      if (!t) return jsonError(404, "not found");
      return json({ task: t });
    }

    const projectFileMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/file$/
    );
    if (projectFileMatch && method === "DELETE") {
      const id = decodeURIComponent(projectFileMatch[1]!);
      if (!(await canAccessProject(id, authenticatedUser))) return jsonError(403, "forbidden");
      const filePath = url.searchParams.get("path");
      if (!filePath) return jsonError(400, "path is required");
      try {
        await deleteProjectFile(id, filePath);
        return json({ ok: true });
      } catch (e: unknown) {
        return toApiErrorResponse(e, {
          route: pathname,
          method,
          fallbackStatus: 400,
          fallbackMessage: "delete failed",
          fallbackCode: "delete_failed",
        });
      }
    }

    const gitMatch = pathname.match(/^\/api\/projects\/([^/]+)\/git\/([a-z-]+)$/);
    if (gitMatch) {
      const id = decodeURIComponent(gitMatch[1]!);
      const action = gitMatch[2]!;
      if (!(await canAccessProject(id, authenticatedUser))) return jsonError(403, "forbidden");
      const project = await getProjectRow(id);
      if (!project) return jsonError(404, "not found");
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
      } catch (e: unknown) {
        return toApiErrorResponse(e, {
          route: pathname,
          method,
          fallbackStatus: 400,
          fallbackMessage: "Git operation failed",
          fallbackCode: "git_operation_failed",
        });
      }
    }

    const projectUserTerminalsMatch = pathname.match(
      /^\/api\/projects\/([^/]+)\/user-terminals$/
    );
    if (projectUserTerminalsMatch) {
      const id = decodeURIComponent(projectUserTerminalsMatch[1]!);
      if (!(await canAccessProject(id, authenticatedUser))) return jsonError(403, "forbidden");
      if (method === "GET") return json({ terminals: await listUserTerminals(id) });
      if (method === "POST") {
        const parsed = await parseBody(request, createUserTerminalBodySchema);
        if (!parsed.ok) return parsed.response;
        const t = await createUserTerminal({
          projectId: id,
          name: parsed.data.name,
          cwd: parsed.data.cwd ?? null,
          startCommand: parsed.data.startCommand ?? null,
        });
        return json({ terminal: t }, { status: 201 });
      }
    }

    const userTerminalMatch = pathname.match(/^\/api\/user-terminals\/([^/]+)$/);
    if (userTerminalMatch) {
      const id = decodeURIComponent(userTerminalMatch[1]!);
      if (!(await canAccessUserTerminal(id, authenticatedUser))) return jsonError(403, "forbidden");
      if (method === "PATCH") {
        const parsed = await parseBody(request, renameUserTerminalBodySchema);
        if (!parsed.ok) return parsed.response;
        const t = await renameUserTerminal(id, parsed.data.name);
        if (!t) return jsonError(404, "not found");
        return json({ terminal: t });
      }
      if (method === "DELETE") {
        const ok = await deleteUserTerminal(id);
        if (!ok) return jsonError(404, "not found");
        return new Response(null, { status: 204 });
      }
    }

    if (pathname === "/api/settings") {
      const settingsScope = { userId: authenticatedUser?.id ?? null };
      const getAccentColorSetting = async (): Promise<AccentColorId> => {
        const value = await getSetting("accent_color", settingsScope);
        return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
      };
      const settingsPayload = async () => ({
        agentSystemBannerDisabled: await getBooleanSetting("agent_system_banner_disabled", false, settingsScope),
        accentColor: await getAccentColorSetting(),
        mouseGradientDisabled: await getBooleanSetting("mouse_gradient_disabled", false, settingsScope),
        sessionFinishToastEnabled: await getBooleanSetting(
          "session_finish_toast_enabled",
          true,
          settingsScope,
        ),
        sessionFinishOsNotificationEnabled: await getBooleanSetting(
          "session_finish_os_notification_enabled",
          false,
          settingsScope,
        ),
        launchAudioDisabled: await getBooleanSetting("launch_audio_disabled", false, settingsScope),
      });
      if (method === "GET") {
        return json(await settingsPayload());
      }
      if (method === "POST") {
        const parsed = await parseBody(request, settingsBodySchema);
        if (!parsed.ok) return parsed.response;
        const body = parsed.data as Record<string, unknown>;
        if ((body as { regenerate?: unknown }).regenerate === true) {
          if (isCloudMode()) return jsonError(403, "API token regeneration is local-only");
          const rl = rateLimit("settings-regenerate", clientKeyFromRequest(request), {
            max: 3,
            windowMs: 60 * 60 * 1000,
          });
          if (!rl.ok) return rateLimitResponse(rl.retryAfterSec, "Too many token regenerations");
          const confirmed = await confirmTokenRegeneration();
          if (!confirmed) {
            return jsonError(403, "User cancelled token regeneration");
          }
          const apiToken = await regenerateApiToken(settingsScope);
          refreshApiTokenAfterRegenerate(apiToken);
          return json({ ...(await settingsPayload()), apiToken });
        }
        if (typeof body?.agentSystemBannerDisabled === "boolean") {
          await setBooleanSetting("agent_system_banner_disabled", body.agentSystemBannerDisabled, settingsScope);
        }
        if (body?.accentColor !== undefined) {
          if (!isAccentColorId(body.accentColor)) return jsonError(400, "invalid accentColor");
          await setSetting("accent_color", body.accentColor, settingsScope);
        }
        if (typeof body?.mouseGradientDisabled === "boolean") {
          await setBooleanSetting("mouse_gradient_disabled", body.mouseGradientDisabled, settingsScope);
        }
        if (typeof body?.sessionFinishToastEnabled === "boolean") {
          await setBooleanSetting(
            "session_finish_toast_enabled",
            body.sessionFinishToastEnabled,
            settingsScope,
          );
        }
        if (typeof body?.sessionFinishOsNotificationEnabled === "boolean") {
          await setBooleanSetting(
            "session_finish_os_notification_enabled",
            body.sessionFinishOsNotificationEnabled,
            settingsScope,
          );
        }
        if (typeof body?.launchAudioDisabled === "boolean") {
          await setBooleanSetting("launch_audio_disabled", body.launchAudioDisabled, settingsScope);
        }
        return json(await settingsPayload());
      }
    }

    if (pathname === "/api/license") {
      if (method === "GET") {
        return json({ license: await readLicenseState(authenticatedUser?.id ?? null) });
      }
      if (method === "DELETE") {
        return json({ license: await removeLicense(authenticatedUser?.id ?? null) });
      }
    }

    if (pathname === "/api/license/validate" && method === "POST") {
      const rl = rateLimit("license-validate", clientKeyFromRequest(request), {
        max: 10,
        windowMs: 60 * 1000,
      });
      if (!rl.ok) return rateLimitResponse(rl.retryAfterSec, "Too many license validation attempts");
      const parsed = await parseBody(request, licenseValidateBodySchema);
      if (!parsed.ok) return parsed.response;
      const license = await validateLicense(parsed.data.key, authenticatedUser?.id ?? null);
      return json({ license });
    }

    if (pathname === "/api/skills") {
      if (method === "GET") return json(await readSkillsStatus(authenticatedUser?.id ?? null));
    }

    if (pathname === "/api/skills/install/installed" && method === "GET") {
      // Renderer must pass projectId (server-trusted) — we resolve the working
      // directory ourselves so the renderer can't point this at an arbitrary
      // path on disk.
      const projectId = url.searchParams.get("projectId");
      if (!projectId) return jsonError(400, "projectId is required");
      if (!(await canAccessProject(projectId, authenticatedUser))) return jsonError(403, "forbidden");
      const project = await getProjectRow(projectId);
      if (!project) return jsonError(400, "unknown projectId");
      return json({ installed: await readInstalledSkillsVersionForProject(project) });
    }

    if (pathname === "/api/skills/install/latest" && method === "GET") {
      try {
        const manifest = await fetchLatestSkillsManifest(authenticatedUser?.id ?? null);
        return json({ manifest });
      } catch (e: unknown) {
        return toApiErrorResponse(e, {
          route: pathname,
          method,
          fallbackStatus: 502,
          fallbackMessage: "Failed to fetch manifest",
          fallbackCode: "skills_manifest_failed",
        });
      }
    }

    if (pathname === "/api/skills/install" && method === "POST") {
      // Caller passes projectId; server resolves the path. Keeps the renderer
      // from being able to install skills into an arbitrary directory.
      const parsed = await parseBody(request, installSkillsBodySchema);
      if (!parsed.ok) return parsed.response;
      if (!(await canAccessProject(parsed.data.projectId, authenticatedUser))) return jsonError(403, "forbidden");
      const project = await getProjectRow(parsed.data.projectId);
      if (!project) return jsonError(400, "unknown projectId");
      try {
        const harnesses = {
          claude: !!parsed.data.harnesses.claude,
          codex: !!parsed.data.harnesses.codex,
        };
        const result =
          project.runtimeKind === "local"
            ? await installProjectSkills({
                projectPath: project.path,
                harnesses,
              }, authenticatedUser?.id ?? null)
            : await installProjectSkillsInRuntime({
                projectId: project.id,
                harnesses,
              }, authenticatedUser?.id ?? null);
        return json({ result });
      } catch (e: unknown) {
        return toApiErrorResponse(e, {
          route: pathname,
          method,
          fallbackStatus: 400,
          fallbackMessage: "Install failed",
          fallbackCode: "install_failed",
        });
      }
    }

    if (pathname === "/api/skills/initialize" && method === "POST") {
      try {
        const result = await initializeSkills(authenticatedUser?.id ?? null);
        return json({ ...result, ...(await readSkillsStatus(authenticatedUser?.id ?? null)) });
      } catch (e: unknown) {
        return toApiErrorResponse(e, { route: pathname, method });
      }
    }

    if (pathname === "/api/launch-kit/access" && method === "GET") {
      return json(await readLaunchKitAccess(authenticatedUser?.id ?? null));
    }

    if (pathname === "/api/launch-kit/projects" && method === "POST") {
      const body = await readJson<any>(request).catch(() => null);
      const parentDir = typeof body?.parentDir === "string" ? body.parentDir : "";
      const projectName = typeof body?.projectName === "string" ? body.projectName : "";
      try {
        const result = await createProjectFromLaunchKit({
          parentDir,
          projectName,
          ownerUserId: authenticatedUser?.id ?? null,
        });
        return json(result, { status: 201 });
      } catch (e: unknown) {
        return toApiErrorResponse(e, {
          route: pathname,
          method,
          fallbackStatus: 400,
          fallbackMessage: "Launch Kit import failed",
          fallbackCode: "launch_kit_import_failed",
        });
      }
    }

    if (pathname === "/api/keybindings") {
      const keybindingScope = { userId: authenticatedUser?.id ?? null };
      if (method === "GET") return json({ bindings: await getBindings("global", keybindingScope) });
      if (method === "PUT") {
        const parsed = await parseBody(request, keybindingBodySchema);
        if (!parsed.ok) return parsed.response;
        const { action, binding } = parsed.data;
        const valid = isValidBinding(binding);
        if (!valid.ok) return jsonError(400, valid.reason);
        return json({ bindings: await setBinding(action, binding, "global", keybindingScope) });
      }
      if (method === "DELETE") {
        const action = url.searchParams.get("action");
        if (action === null) return json({ bindings: await resetAllBindings("global", keybindingScope) });
        if (!(HOTKEY_ACTIONS as readonly string[]).includes(action)) {
          return jsonError(400, "invalid action");
        }
        return json({ bindings: await resetBinding(action as HotkeyAction, "global", keybindingScope) });
      }
    }

    if (agentHookMatch && method === "POST") {
      const slug = agentHookMatch[1]!;
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return jsonError(400, "taskId required");
      const auth = requireTaskAuth(request, taskId);
      if (!auth.ok) return auth.response;
      const rl = rateLimit("hooks", `${clientKeyFromRequest(request)}:${taskId}`, {
        max: 60,
        windowMs: 60 * 1000,
      });
      if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
      const payload = await readJson<{
        hook_event_name?: string;
        prompt?: string;
        notification_type?: string;
        message?: string;
        title?: string;
        session_id?: string;
      }>(request);
      const event = payload?.hook_event_name || "";
      const status = mapHookEventToStatus(payload);
      if (!status) return json({ ok: true, ignored: event });
      // Reject hook events from nested Claude invocations (e.g. plugin Stop
      // hooks that spawn `claude -p` for classification). They inherit our
      // MC_TASK_ID env var but run under their own session_id, so they'd
      // flicker the task running → finished → running → finished and fire
      // duplicate session-finished notifications.
      const task = await getTask(taskId);
      if (!task) return jsonError(404, "task not found");
      // Slug must match the task's agent. A claude hook firing for a codex
      // task (or vice versa) is almost always a nested-shell side effect, not
      // a real status transition.
      if (slug === "claude" && task.agent !== "claude-code") {
        return json({ ok: true, ignored: "agent-mismatch" });
      }
      if (slug === "codex" && task.agent !== "codex") {
        return json({ ok: true, ignored: "agent-mismatch" });
      }
      const incomingSessionId =
        typeof payload?.session_id === "string" ? payload.session_id : "";
      if (
        task.claudeSessionId &&
        incomingSessionId &&
        incomingSessionId !== task.claudeSessionId
      ) {
        return json({ ok: true, ignored: "foreign-session" });
      }
      const t = await updateStatus(taskId, { status });
      if (!t) return jsonError(404, "task not found");
      if (event === "UserPromptSubmit" && typeof payload?.prompt === "string" && payload.prompt.trim()) {
        // Fire-and-forget: don't block the hook response on CLI generation.
        void generateTitleForTask(taskId, payload.prompt).catch((err: unknown) => {
          logger.error("task title generation failed", {
            err,
            route: pathname,
            method,
            taskId,
          });
        });
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
      const summary = await getUsageSummary(days, authenticatedUser?.id ?? null);
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
          const off = events.onAny((e) => {
            const projectId = projectIdFromEvent(e);
            if (!authenticatedUser) {
              send(e);
              return;
            }
            if (!projectId) return;
            void (async () => {
              if (!(await canAccessProject(projectId, authenticatedUser))) return;
              send(e);
            })().catch((err: unknown) => {
              logger.error("api event stream failed", {
                err,
                route: "/api/events",
                method: "GET",
              });
            });
          });
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
  } catch (err: unknown) {
    return toApiErrorResponse(err, { route: pathname, method });
  }
  } catch (err: unknown) {
    return toApiErrorResponse(err, { route: pathname, method });
  }
}

export { mapHookEventToStatus } from "~/shared/agent-hook-events";

async function readJson<T>(request: Request, maxBytes?: number): Promise<T> {
  if (!request.body) return {} as T;
  const text = maxBytes ? await readTextWithLimit(request, maxBytes) : await request.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("request body too large");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

/**
 * Validate `request.body` against a zod schema. On success returns the parsed
 * value; on failure returns a 400 Response with the first zod issue's message.
 */
async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  opts: { maxBytes?: number } = {},
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (opts.maxBytes && Number.isFinite(contentLength) && contentLength > opts.maxBytes) {
    return { ok: false, response: jsonError(413, "request body too large") };
  }
  let raw: unknown;
  try {
    raw = await readJson<unknown>(request, opts.maxBytes);
  } catch (e: unknown) {
    if (getErrorMessage(e) === "request body too large") {
      return { ok: false, response: jsonError(413, "request body too large") };
    }
    return { ok: false, response: jsonError(400, "invalid body") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const message = first
      ? `${first.path.length ? first.path.join(".") + ": " : ""}${first.message}`
      : "invalid body";
    return { ok: false, response: jsonError(400, message) };
  }
  return { ok: true, data: result.data };
}

// --- Zod schemas for highest-leverage routes (input validation surface) ---
const PROJECT_IMAGE_JSON_BODY_MAX_BYTES = MAX_PROJECT_IMAGE_DATA_URL_LENGTH + 20_000;

const createTaskBodySchema = z.object({
  title: z.string().trim().min(1, "title required"),
  agent: z.enum(TASK_AGENTS),
  branch: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  preview: z.string().optional(),
  claudeSessionId: z.string().nullable().optional(),
  claudeSkipPermissions: z.boolean().optional(),
  claudeBareSession: z.boolean().optional(),
});

const installSkillsBodySchema = z.object({
  projectId: z.string().min(1, "projectId required"),
  harnesses: z
    .object({
      claude: z.boolean().optional(),
      codex: z.boolean().optional(),
    })
    .default({}),
});

const licenseValidateBodySchema = z.object({
  key: z.string().trim().min(1, "key required"),
});

const settingsRegenerateSchema = z.object({ regenerate: z.literal(true) });
const settingsUpdateSchema = z
  .object({
    agentSystemBannerDisabled: z.boolean().optional(),
    accentColor: z.string().optional(),
    mouseGradientDisabled: z.boolean().optional(),
    sessionFinishToastEnabled: z.boolean().optional(),
    sessionFinishOsNotificationEnabled: z.boolean().optional(),
    launchAudioDisabled: z.boolean().optional(),
  })
  .passthrough();
const settingsBodySchema = z.union([settingsRegenerateSchema, settingsUpdateSchema]);

const createProjectBodySchema = z.object({
  name: z.string().trim().optional(),
  path: z.string().trim().optional(),
  icon: z.string().optional(),
  iconColor: z.string().optional(),
  imageDataUrl: z.string().max(MAX_PROJECT_IMAGE_DATA_URL_LENGTH).nullable().optional(),
  groupId: z.string().nullable().optional(),
  repoUrl: z.string().nullable().optional(),
});

const launchCommandSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
});

const updateProjectBodySchema = z
  .object({
    togglePin: z.boolean().optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    icon: z.string().optional(),
    iconColor: z.string().optional(),
    imagePath: z.string().nullable().optional(),
    imageDataUrl: z.string().max(MAX_PROJECT_IMAGE_DATA_URL_LENGTH).nullable().optional(),
    groupId: z.string().nullable().optional(),
    pinned: z.boolean().optional(),
    branch: z.string().optional(),
    launchUrl: z.string().nullable().optional(),
    launchCommands: z.array(launchCommandSchema).nullable().optional(),
    rememberAgentSettings: z.boolean().optional(),
    savedAgent: z.enum(TASK_AGENTS).nullable().optional(),
    savedSkipPermissions: z.boolean().optional(),
    savedBareSession: z.boolean().optional(),
  })
  .strict();

const createGroupBodySchema = z.object({
  name: z.string().trim().min(1, "name required"),
  color: z.string().optional(),
});

const updateGroupBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    color: z.string().optional(),
  })
  .strict();

const updateTaskBodySchema = z
  .object({
    title: z.string().optional(),
    branch: z.string().optional(),
    claudeSessionId: z.string().nullable().optional(),
    claudeSkipPermissions: z.boolean().optional(),
    claudeBareSession: z.boolean().optional(),
  })
  .strict();

const taskStatusBodySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    preview: z.string().optional(),
    lines: z.number().int().nonnegative().optional(),
  })
  .strict();

const createUserTerminalBodySchema = z.object({
  name: z.string().trim().optional(),
  cwd: z.string().nullable().optional(),
  startCommand: z.string().nullable().optional(),
});

const renameUserTerminalBodySchema = z.object({
  name: z.string().min(1, "name required"),
});

const keybindingBodySchema = z.object({
  action: z.enum(HOTKEY_ACTIONS as readonly [HotkeyAction, ...HotkeyAction[]]),
  binding: z.object({
    mod: z.boolean().optional().default(false),
    shift: z.boolean().optional().default(false),
    alt: z.boolean().optional().default(false),
    key: z.string(),
  }).transform((b) => ({
    mod: !!b.mod,
    shift: !!b.shift,
    alt: !!b.alt,
    key: b.key,
  })),
});
