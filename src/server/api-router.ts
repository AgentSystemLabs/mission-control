import { randomUUID } from "node:crypto";
import {
  jsonError,
  requireBearerToken,
  requireLocalOrigin,
} from "./auth";
import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
} from "~/shared/http-status";
import * as projectsController from "./controllers/projects.controller";
import * as sandboxesController from "./controllers/sandboxes.controller";
import * as worktreesController from "./controllers/worktrees.controller";
import * as tasksController from "./controllers/tasks.controller";
import * as groupsController from "./controllers/groups.controller";
import * as userTerminalsController from "./controllers/user-terminals.controller";
import * as homeTerminalsController from "./controllers/home-terminals.controller";
import * as settingsController from "./controllers/settings.controller";
import * as keybindingsController from "./controllers/keybindings.controller";
import * as skillsController from "./controllers/skills.controller";
import * as hooksController from "./controllers/hooks.controller";
import * as promptsController from "./controllers/prompts.controller";
import * as projectMemoryController from "./controllers/project-memory.controller";
import * as scratchPadsController from "./controllers/scratch-pads.controller";
import * as codeGraphController from "./controllers/code-graph.controller";
import * as usageController from "./controllers/usage.controller";
import * as claudeUsageLimitsController from "./controllers/claude-usage-limits.controller";
import * as providerUsageController from "./controllers/provider-usage.controller";
import * as agentLaunchersController from "./controllers/agent-launchers.controller";
import * as eventsController from "./controllers/events.controller";
import * as gitController from "./controllers/git.controller";
import * as commitCliController from "./controllers/commit-cli.controller";
import * as projectFileController from "./controllers/project-file.controller";
import * as healthController from "./controllers/health.controller";
import * as diagramsController from "./controllers/diagrams.controller";
import * as markdownController from "./controllers/markdown.controller";
import * as aiRuntimeModelsController from "./controllers/ai-runtime-models.controller";

const AGENT_HOOK_PATH = /^\/api\/hooks\/([a-z0-9-]+)$/;
const PROJECT_PATH = /^\/api\/projects\/([^/]+)$/;
const PROJECT_PATH_STATUS_PATH = /^\/api\/projects\/([^/]+)\/path-status$/;
const PROJECT_WORKTREES_PATH = /^\/api\/projects\/([^/]+)\/worktrees$/;
const PROJECT_WORKTREE_PATH = /^\/api\/projects\/([^/]+)\/worktrees\/([^/]+)$/;
const PROJECT_TASKS_PATH = /^\/api\/projects\/([^/]+)\/tasks$/;
const PROJECT_FILE_PATH = /^\/api\/projects\/([^/]+)\/file$/;
const PROJECT_GIT_PATH = /^\/api\/projects\/([^/]+)\/git\/([a-z-]+)$/;
const PROJECT_USER_TERMINALS_PATH = /^\/api\/projects\/([^/]+)\/user-terminals$/;
const PROJECT_MEMORY_PATH = /^\/api\/projects\/([^/]+)\/memory$/;
const PROJECT_BRIEF_PATH = /^\/api\/projects\/([^/]+)\/brief$/;
const PROJECT_MEMORY_SEARCH_PATH = /^\/api\/projects\/([^/]+)\/memory\/search$/;
const MEMORY_PATH = /^\/api\/memory\/([^/]+)$/;
const PROJECT_SCRATCH_PADS_PATH = /^\/api\/projects\/([^/]+)\/scratch-pads$/;
const PROJECT_SCRATCH_PAD_PATH = /^\/api\/projects\/([^/]+)\/scratch-pads\/([^/]+)$/;
const MEMORY_VERIFY_PATH = /^\/api\/memory\/([^/]+)\/verify$/;
const PROJECT_GRAPH_STATUS_PATH = /^\/api\/projects\/([^/]+)\/graph\/status$/;
const PROJECT_GRAPH_SUMMARY_PATH = /^\/api\/projects\/([^/]+)\/graph\/summary$/;
const PROJECT_GRAPH_INDEX_PATH = /^\/api\/projects\/([^/]+)\/graph\/index$/;
const PROJECT_GRAPH_INDEX_CANCEL_PATH = /^\/api\/projects\/([^/]+)\/graph\/index\/cancel$/;
const PROJECT_GRAPH_SEARCH_PATH = /^\/api\/projects\/([^/]+)\/graph\/search$/;
const PROJECT_GRAPH_NODE_PATH = /^\/api\/projects\/([^/]+)\/graph\/node$/;
const PROJECT_GRAPH_NEIGHBORS_PATH = /^\/api\/projects\/([^/]+)\/graph\/neighbors$/;
const PROJECT_GRAPH_PATH_PATH = /^\/api\/projects\/([^/]+)\/graph\/path$/;
const PROJECT_GRAPH_IMPACT_PATH = /^\/api\/projects\/([^/]+)\/graph\/impact$/;
const SANDBOX_PATH = /^\/api\/sandboxes\/([^/]+)$/;
const SANDBOX_API_KEY_PATH = /^\/api\/sandboxes\/([^/]+)\/api-key$/;
const GROUP_PATH = /^\/api\/groups\/([^/]+)$/;
// Literal path — checked before TASK_PATH so the id patterns never see it.
const TASK_SWEEP_DISCONNECTED_PATH = "/api/tasks/sweep-disconnected";
const TASK_PATH = /^\/api\/tasks\/([^/]+)$/;
const TASK_STATUS_PATH = /^\/api\/tasks\/([^/]+)\/status$/;
const TASK_QUESTION_PATH = /^\/api\/tasks\/([^/]+)\/question$/;
const TASK_ARCHIVE_PATH = /^\/api\/tasks\/([^/]+)\/archive$/;
const TASK_RESTORE_PATH = /^\/api\/tasks\/([^/]+)\/restore$/;
const TASK_BRIEF_PATH = /^\/api\/tasks\/([^/]+)\/brief$/;
const USER_TERMINAL_PATH = /^\/api\/user-terminals\/([^/]+)$/;
const HOME_USER_TERMINAL_PATH = /^\/api\/home\/user-terminals\/([^/]+)$/;
const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_ID_HEADER = "x-correlation-id";
const REQUEST_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;

function decode(segment: string | undefined): string {
  return decodeURIComponent(segment ?? "");
}

function requestHeaderId(request: Request, header: string): string | null {
  const value = request.headers.get(header)?.trim();
  return value && REQUEST_ID_RE.test(value) ? value : null;
}

function applyRequestHeaders(
  response: Response,
  requestId: string,
  correlationId: string,
): Response {
  const setCookies = getSetCookieHeaders(response.headers);
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers.set(key, value);
  });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(CORRELATION_ID_HEADER, correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.();
  if (values?.length) return values;
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
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
 * Centralized auth gate. Default: every /api/* route requires the local bearer
 * token. Opt-outs:
 *  - Routes in ANONYMOUS_ROUTES (intentional public auth handoff surface).
 *  - /api/events SSE: EventSource cannot send custom headers, so it uses a
 *    short-lived, single-use ticket issued by POST /api/events/ticket.
 */
function requireApiAuth(
  request: Request,
  method: string,
  pathname: string,
): { ok: true } | { ok: false; response: Response } {
  if (isAnonymousRoute(method, pathname)) return { ok: true };
  if (pathname === "/api/events" && method === "GET") return { ok: true };
  return requireBearerToken(request);
}

const SENSITIVE_QUERY_PARAM_RE = /([?&])(token|ticket)=[^&#\s"']+/gi;

export function redactSensitiveErrorText(value: string): string {
  return value.replace(SENSITIVE_QUERY_PARAM_RE, "$1$2=<redacted>");
}

function isCallerFacingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { expose?: unknown; name?: unknown };
  return maybe.expose === true || maybe.name === "ZodError";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "bad request";
  if (typeof err === "string") return err || "bad request";
  return "bad request";
}

function withApiAuth(fn: typeof dispatch) {
  return async (
    request: Request,
    url: URL,
    method: string,
    pathname: string,
  ): Promise<Response> => {
    const auth = requireApiAuth(request, method, pathname);
    if (!auth.ok) return auth.response;

    try {
      return await fn(request, url, method, pathname);
    } catch (err) {
      const message = redactSensitiveErrorText(errorMessage(err));
      if (isCallerFacingError(err)) return jsonError(HTTP_BAD_REQUEST, message);

      console.error(`[api] unhandled in dispatch ${method} ${pathname}: ${message}`);
      return jsonError(HTTP_INTERNAL_SERVER_ERROR, "internal error");
    }
  };
}

const protectedDispatch = withApiAuth(dispatch);

/** Pure Web `Request → Response` API router for `/api/*`. Reused in dev (Vite middleware) and prod. */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (!pathname.startsWith("/api/")) return null;
  const requestId = requestHeaderId(request, REQUEST_ID_HEADER) ?? randomUUID();
  const correlationId = requestHeaderId(request, CORRELATION_ID_HEADER) ?? requestId;

  if (pathname === "/api/healthz" && method === "GET") {
    return applyRequestHeaders(await healthController.read(), requestId, correlationId);
  }

  const origin = requireLocalOrigin(request);
  if (!origin.ok) return applyRequestHeaders(origin.response, requestId, correlationId);

  const response = await protectedDispatch(request, url, method, pathname);
  return applyRequestHeaders(response, requestId, correlationId);
}

async function dispatch(
  request: Request,
  url: URL,
  method: string,
  pathname: string,
): Promise<Response> {
  // Projects
  if (pathname === "/api/projects") {
    if (method === "GET") return projectsController.list(request);
    if (method === "POST") return projectsController.create(request);
  }
  if (pathname === "/api/projects/pinned-order" && method === "PATCH") {
    return projectsController.reorderPinned(request);
  }
  let m = pathname.match(PROJECT_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return projectsController.getOne(id, request);
    if (method === "PATCH") return projectsController.update(id, request);
    if (method === "DELETE") return projectsController.remove(id, request);
  }
  m = pathname.match(PROJECT_PATH_STATUS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return projectsController.pathStatus(id, request);
  }

  // Sandboxes (scopes). Literal subpaths are matched before the :id regex so
  // "active"/"enabled" aren't treated as sandbox ids.
  if (pathname === "/api/sandboxes") {
    if (method === "GET") return sandboxesController.list(request);
  }
  if (pathname === "/api/sandboxes/connect" && method === "POST") {
    return sandboxesController.connect(request);
  }
  if (pathname === "/api/sandboxes/active" && method === "PUT") {
    return sandboxesController.setActive(request);
  }
  if (pathname === "/api/sandboxes/enabled" && method === "PUT") {
    return sandboxesController.setEnabled(request);
  }
  m = pathname.match(SANDBOX_API_KEY_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return sandboxesController.revealApiKey(id, request);
  }
  m = pathname.match(SANDBOX_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return sandboxesController.update(id, request);
    if (method === "DELETE") return sandboxesController.remove(id, request);
  }
  m = pathname.match(PROJECT_TASKS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return tasksController.listForProject(id, request);
    if (method === "POST") return tasksController.create(id, request);
  }
  m = pathname.match(PROJECT_WORKTREES_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return worktreesController.list(id, request);
    if (method === "POST") return worktreesController.create(id, request);
  }
  m = pathname.match(PROJECT_WORKTREE_PATH);
  if (m) {
    const id = decode(m[1]);
    const worktreeId = decode(m[2]);
    if (method === "DELETE") return worktreesController.remove(id, worktreeId, request);
  }
  m = pathname.match(PROJECT_FILE_PATH);
  if (m && method === "DELETE") {
    return projectFileController.remove(decode(m[1]), url);
  }
  m = pathname.match(PROJECT_GIT_PATH);
  if (m) {
    const id = decode(m[1]);
    const action = m[2]!;
    if (action === "status" && method === "GET") return gitController.status(id, url);
    if (action === "branches" && method === "GET") return gitController.branches(id, url);
    if (action === "diff" && method === "GET") return gitController.diff(id, url);
    if (action === "stage" && method === "POST") return gitController.stage(id, request);
    if (action === "unstage" && method === "POST") return gitController.unstage(id, request);
    if (action === "commit" && method === "POST") return gitController.commit(id, request);
    if (action === "push" && method === "POST") return gitController.push(id, request);
    if (action === "fetch" && method === "POST") return gitController.fetch(id, request);
    if (action === "pull" && method === "POST") return gitController.pull(id, request);
    if (action === "create-pr" && method === "POST") return gitController.createPr(id, request);
    if (action === "checkout" && method === "POST") return gitController.checkout(id, request);
  }
  m = pathname.match(PROJECT_USER_TERMINALS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return userTerminalsController.listForProject(id, request);
    if (method === "POST") return userTerminalsController.create(id, request);
  }

  // Recall — project memory. Literal `/memory/search` is matched before the
  // `/memory$` collection route.
  m = pathname.match(PROJECT_MEMORY_SEARCH_PATH);
  if (m && method === "GET") return projectMemoryController.search(decode(m[1]), url);
  m = pathname.match(PROJECT_MEMORY_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return projectMemoryController.list(id, url);
    if (method === "POST") return projectMemoryController.create(id, request);
  }
  m = pathname.match(PROJECT_BRIEF_PATH);
  if (m && method === "GET") return projectMemoryController.previewBrief(decode(m[1]));
  // Literal `/memory/:id/verify` before the `/memory/:id` item route.
  m = pathname.match(MEMORY_VERIFY_PATH);
  if (m && method === "POST") return projectMemoryController.verify(decode(m[1]), url);
  m = pathname.match(MEMORY_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return projectMemoryController.update(id, request);
    if (method === "DELETE") return projectMemoryController.remove(id, url);
  }

  // Scratch pads — per-project temporary text buffers. Item routes stay nested
  // under the project so ownership is checked against the addressed project.
  m = pathname.match(PROJECT_SCRATCH_PADS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return scratchPadsController.list(id);
    if (method === "POST") return scratchPadsController.create(id, request);
  }
  m = pathname.match(PROJECT_SCRATCH_PAD_PATH);
  if (m) {
    const projectId = decode(m[1]);
    const padId = decode(m[2]);
    if (method === "PATCH") return scratchPadsController.update(projectId, padId, request);
    if (method === "DELETE") return scratchPadsController.remove(projectId, padId);
  }

  // Recall — code graph. Literal `/graph/index/cancel` before `/graph/index`.
  m = pathname.match(PROJECT_GRAPH_STATUS_PATH);
  if (m && method === "GET") return codeGraphController.status(decode(m[1]));
  m = pathname.match(PROJECT_GRAPH_SUMMARY_PATH);
  if (m && method === "GET") return codeGraphController.summary(decode(m[1]));
  m = pathname.match(PROJECT_GRAPH_INDEX_CANCEL_PATH);
  if (m && method === "POST") return codeGraphController.cancelIndex(decode(m[1]));
  m = pathname.match(PROJECT_GRAPH_INDEX_PATH);
  if (m && method === "POST") return codeGraphController.index(decode(m[1]), url);
  m = pathname.match(PROJECT_GRAPH_SEARCH_PATH);
  if (m && method === "GET") return codeGraphController.search(decode(m[1]), url);
  m = pathname.match(PROJECT_GRAPH_NODE_PATH);
  if (m && method === "GET") return codeGraphController.node(decode(m[1]), url);
  m = pathname.match(PROJECT_GRAPH_NEIGHBORS_PATH);
  if (m && method === "GET") return codeGraphController.neighbors(decode(m[1]), url);
  m = pathname.match(PROJECT_GRAPH_PATH_PATH);
  if (m && method === "GET") return codeGraphController.path(decode(m[1]), url);
  m = pathname.match(PROJECT_GRAPH_IMPACT_PATH);
  if (m && method === "GET") return codeGraphController.impact(decode(m[1]), url);

  // Groups
  if (pathname === "/api/groups") {
    if (method === "GET") return groupsController.list(request);
    if (method === "POST") return groupsController.create(request);
  }
  // Must precede GROUP_PATH — otherwise "order" is captured as a group id.
  if (pathname === "/api/groups/order" && method === "PATCH") {
    return groupsController.reorder(request);
  }
  m = pathname.match(GROUP_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return groupsController.update(id, request);
    if (method === "DELETE") return groupsController.remove(id, request);
  }

  // Tasks
  if (pathname === TASK_SWEEP_DISCONNECTED_PATH && method === "POST") {
    return tasksController.sweepDisconnected();
  }
  m = pathname.match(TASK_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return tasksController.getOne(id, request);
    if (method === "PATCH") return tasksController.update(id, request);
    if (method === "DELETE") return tasksController.remove(id, request);
  }
  m = pathname.match(TASK_STATUS_PATH);
  if (m && method === "POST") return tasksController.setStatus(decode(m[1]), request);
  m = pathname.match(TASK_QUESTION_PATH);
  if (m && method === "GET") return tasksController.readQuestion(decode(m[1]));
  m = pathname.match(TASK_ARCHIVE_PATH);
  if (m && method === "POST") return tasksController.archive(decode(m[1]), request);
  m = pathname.match(TASK_RESTORE_PATH);
  if (m && method === "POST") return tasksController.restore(decode(m[1]), request);
  m = pathname.match(TASK_BRIEF_PATH);
  if (m && method === "GET") return projectMemoryController.brief(decode(m[1]), url);

  // User terminals
  m = pathname.match(USER_TERMINAL_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return userTerminalsController.rename(id, request);
    if (method === "DELETE") return userTerminalsController.remove(id, request);
  }

  // Home terminals (project-less dashboard terminals)
  if (pathname === "/api/home/user-terminals") {
    if (method === "GET") return homeTerminalsController.listAll(request);
    if (method === "POST") return homeTerminalsController.create(request);
  }
  m = pathname.match(HOME_USER_TERMINAL_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return homeTerminalsController.rename(id, request);
    if (method === "DELETE") return homeTerminalsController.remove(id, request);
  }

  // Settings
  if (pathname === "/api/settings") {
    if (method === "GET") return settingsController.read();
    if (method === "POST") return settingsController.update(request);
  }
  if (pathname === "/api/commit-cli/detect" && method === "GET") {
    return commitCliController.detect();
  }
  if (pathname === "/api/ai-runtime/models" && method === "GET") {
    return aiRuntimeModelsController.list(url);
  }

  // Diagram skill (local bundled install)
  if (pathname === "/api/skills/install/diagram/installed" && method === "GET") {
    return skillsController.diagramInstalled(url);
  }
  if (pathname === "/api/skills/install/diagram" && method === "POST") {
    return skillsController.installDiagram(request);
  }
  if (pathname === "/api/skills/install/ship/installed" && method === "GET") {
    return skillsController.shipInstalled(url);
  }
  if (pathname === "/api/skills/install/ship" && method === "POST") {
    return skillsController.installShip(request);
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

  if (pathname === "/api/diagram" && method === "GET") {
    return diagramsController.read(url);
  }
  if (pathname === "/api/diagram" && method === "POST") {
    return diagramsController.submit(url, request);
  }
  if (pathname === "/api/diagrams" && method === "GET") {
    return diagramsController.list(url);
  }

  // Markdown annotation refine (AI rewrite from reviewer comments)
  if (pathname === "/api/markdown/refine" && method === "POST") {
    return markdownController.refine(request);
  }

  // Prompt history search
  if (pathname === "/api/prompts" && method === "GET") return promptsController.search(url);

  // Usage + events
  if (pathname === "/api/usage" && method === "GET") return usageController.read(url);
  if (pathname === "/api/claude-usage-limits" && method === "GET") {
    return claudeUsageLimitsController.read();
  }
  if (pathname === "/api/provider-usage" && method === "GET") {
    return providerUsageController.read(url);
  }
  if (pathname === "/api/agent-launchers/accounts" && method === "GET") {
    return agentLaunchersController.accounts();
  }
  if (pathname === "/api/agent-launchers/latest-versions" && method === "GET") {
    return agentLaunchersController.latestVersions(url);
  }
  if (pathname === "/api/events/ticket" && method === "POST") {
    return eventsController.issueTicket();
  }
  if (pathname === "/api/events" && method === "GET") return eventsController.stream(url);

  return jsonError(HTTP_NOT_FOUND, "not found");
}

export { mapHookEventToStatus } from "~/shared/agent-hook-events";
