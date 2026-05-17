import {
  jsonError,
  requireBearerToken,
  requireBearerTokenValue,
  requireLocalOrigin,
} from "./auth";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "~/shared/http-status";
import * as projectsController from "./controllers/projects.controller";
import * as tasksController from "./controllers/tasks.controller";
import * as groupsController from "./controllers/groups.controller";
import * as userTerminalsController from "./controllers/user-terminals.controller";
import * as settingsController from "./controllers/settings.controller";
import * as licenseController from "./controllers/license.controller";
import * as keybindingsController from "./controllers/keybindings.controller";
import * as skillsController from "./controllers/skills.controller";
import * as launchKitController from "./controllers/launch-kit.controller";
import * as hooksController from "./controllers/hooks.controller";
import * as usageController from "./controllers/usage.controller";
import * as eventsController from "./controllers/events.controller";
import * as gitController from "./controllers/git.controller";
import * as projectFileController from "./controllers/project-file.controller";

const AGENT_HOOK_PATH = /^\/api\/hooks\/([a-z0-9-]+)$/;
const PROJECT_PATH = /^\/api\/projects\/([^\/]+)$/;
const PROJECT_TASKS_PATH = /^\/api\/projects\/([^\/]+)\/tasks$/;
const PROJECT_FILE_PATH = /^\/api\/projects\/([^\/]+)\/file$/;
const PROJECT_GIT_PATH = /^\/api\/projects\/([^\/]+)\/git\/([a-z-]+)$/;
const PROJECT_USER_TERMINALS_PATH = /^\/api\/projects\/([^\/]+)\/user-terminals$/;
const GROUP_PATH = /^\/api\/groups\/([^\/]+)$/;
const TASK_PATH = /^\/api\/tasks\/([^\/]+)$/;
const TASK_STATUS_PATH = /^\/api\/tasks\/([^\/]+)\/status$/;
const TASK_ARCHIVE_PATH = /^\/api\/tasks\/([^\/]+)\/archive$/;
const TASK_RESTORE_PATH = /^\/api\/tasks\/([^\/]+)\/restore$/;
const USER_TERMINAL_PATH = /^\/api\/user-terminals\/([^\/]+)$/;

function decode(segment: string | undefined): string {
  return decodeURIComponent(segment ?? "");
}

// Routes that intentionally accept anonymous requests after the same-origin
// gate (auth.ts:requireLocalOrigin). Keep empty — every leaf route should
// require the bearer token. Adding an entry here is the *only* way a route
// can be reached without auth, which makes auth-bypass regressions a one-grep
// review surface. Exported so __tests__/api-auth.test.ts can snapshot the
// list and fail CI on any addition.
export const ANONYMOUS_ROUTES: ReadonlyArray<{ method: string; pathname: string }> = [];

function isAnonymousRoute(method: string, pathname: string): boolean {
  return ANONYMOUS_ROUTES.some(
    (r) => r.method === method && r.pathname === pathname,
  );
}

/**
 * Centralized auth gate. Default: every /api/* route requires the bearer
 * token. Opt-outs:
 *  - Routes in ANONYMOUS_ROUTES (intentional public surface — none today).
 *  - /api/events SSE: EventSource cannot send custom headers, so the token
 *    travels in `?token=<bearer>` instead. Constant-time-compared by
 *    requireBearerTokenValue just like the header path.
 */
function requireApiAuth(
  request: Request,
  url: URL,
  method: string,
  pathname: string,
): { ok: true } | { ok: false; response: Response } {
  if (isAnonymousRoute(method, pathname)) return { ok: true };
  if (pathname === "/api/events" && method === "GET") {
    return requireBearerTokenValue(url.searchParams.get("token"));
  }
  return requireBearerToken(request);
}

/** Pure Web `Request → Response` API router for `/api/*`. Reused in dev (Vite middleware) and prod. */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (!pathname.startsWith("/api/")) return null;

  const origin = requireLocalOrigin(request);
  if (!origin.ok) return origin.response;

  const auth = requireApiAuth(request, url, method, pathname);
  if (!auth.ok) return auth.response;

  try {
    return await dispatch(request, url, method, pathname);
  } catch (err: any) {
    const message = err?.message || "bad request";
    return jsonError(HTTP_BAD_REQUEST, message);
  }
}

async function dispatch(
  request: Request,
  url: URL,
  method: string,
  pathname: string,
): Promise<Response> {
  // Projects
  if (pathname === "/api/projects") {
    if (method === "GET") return projectsController.list();
    if (method === "POST") return projectsController.create(request);
  }
  let m = pathname.match(PROJECT_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return projectsController.getOne(id);
    if (method === "PATCH") return projectsController.update(id, request);
    if (method === "DELETE") return projectsController.remove(id);
  }
  m = pathname.match(PROJECT_TASKS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return tasksController.listForProject(id);
    if (method === "POST") return tasksController.create(id, request);
  }
  m = pathname.match(PROJECT_FILE_PATH);
  if (m && method === "DELETE") {
    return projectFileController.remove(decode(m[1]), url);
  }
  m = pathname.match(PROJECT_GIT_PATH);
  if (m) {
    const id = decode(m[1]);
    const action = m[2]!;
    if (action === "status" && method === "GET") return gitController.status(id);
    if (action === "diff" && method === "GET") return gitController.diff(id, url);
    if (action === "stage" && method === "POST") return gitController.stage(id, request);
    if (action === "unstage" && method === "POST") return gitController.unstage(id, request);
    if (action === "commit" && method === "POST") return gitController.commit(id, request);
    if (action === "push" && method === "POST") return gitController.push(id);
  }
  m = pathname.match(PROJECT_USER_TERMINALS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return userTerminalsController.listForProject(id);
    if (method === "POST") return userTerminalsController.create(id, request);
  }

  // Groups
  if (pathname === "/api/groups") {
    if (method === "GET") return groupsController.list();
    if (method === "POST") return groupsController.create(request);
  }
  m = pathname.match(GROUP_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return groupsController.update(id, request);
    if (method === "DELETE") return groupsController.remove(id);
  }

  // Tasks
  m = pathname.match(TASK_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return tasksController.getOne(id);
    if (method === "PATCH") return tasksController.update(id, request);
    if (method === "DELETE") return tasksController.remove(id);
  }
  m = pathname.match(TASK_STATUS_PATH);
  if (m && method === "POST") return tasksController.setStatus(decode(m[1]), request);
  m = pathname.match(TASK_ARCHIVE_PATH);
  if (m && method === "POST") return tasksController.archive(decode(m[1]));
  m = pathname.match(TASK_RESTORE_PATH);
  if (m && method === "POST") return tasksController.restore(decode(m[1]));

  // User terminals
  m = pathname.match(USER_TERMINAL_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return userTerminalsController.rename(id, request);
    if (method === "DELETE") return userTerminalsController.remove(id);
  }

  // Settings
  if (pathname === "/api/settings") {
    if (method === "GET") return settingsController.read();
    if (method === "POST") return settingsController.update(request);
  }

  // License
  if (pathname === "/api/license") {
    if (method === "GET") return licenseController.read();
    if (method === "DELETE") return licenseController.remove();
  }
  if (pathname === "/api/license/validate" && method === "POST") {
    return licenseController.validate(request);
  }

  // Skills
  if (pathname === "/api/skills/install/installed" && method === "GET") {
    return skillsController.installed(url);
  }
  if (pathname === "/api/skills/install/latest" && method === "GET") {
    return skillsController.latest();
  }
  if (pathname === "/api/skills/install" && method === "POST") {
    return skillsController.install(request);
  }

  // Launch Kit
  if (pathname === "/api/launch-kit/access" && method === "GET") {
    return launchKitController.access();
  }
  if (pathname === "/api/launch-kit/projects" && method === "POST") {
    return launchKitController.create(request);
  }

  // Keybindings
  if (pathname === "/api/keybindings") {
    if (method === "GET") return keybindingsController.list();
    if (method === "PUT") return keybindingsController.set(request);
    if (method === "DELETE") return keybindingsController.reset(url);
  }

  // Agent hooks
  m = pathname.match(AGENT_HOOK_PATH);
  if (m && method === "POST") return hooksController.receive(url, request);

  // Usage + events
  if (pathname === "/api/usage" && method === "GET") return usageController.read(url);
  if (pathname === "/api/events" && method === "GET") return eventsController.stream();

  return jsonError(HTTP_NOT_FOUND, "not found");
}

export { mapHookEventToStatus } from "~/shared/agent-hook-events";
