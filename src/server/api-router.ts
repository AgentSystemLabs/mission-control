import { randomUUID } from "node:crypto";
import {
  jsonError,
  requireBearerToken,
  requireBearerTokenValueForSecret,
  requireLocalOrigin,
} from "./auth";
import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
} from "~/shared/http-status";
import * as projectsController from "./controllers/projects.controller";
import * as worktreesController from "./controllers/worktrees.controller";
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
import * as entitlementsController from "./controllers/entitlements.controller";
import * as remotePtyController from "./controllers/remote-pty.controller";
import * as academyAuthController from "./controllers/academy-auth.controller";
import * as healthController from "./controllers/health.controller";
import * as metricsController from "./controllers/metrics.controller";
import * as supportController from "./controllers/support.controller";
import { getHostedAuthContext } from "./hosted-auth-context";
import { isHostedDatabaseEnabled } from "./hosted-pg";
import { validateHostedHookToken } from "./services/hosted-hook-tokens";
import { withHostedLogContext } from "./services/hosted-logs";
import { reportHostedServerException } from "./services/hosted-alerts";
import { incrementHostedCounter } from "./services/hosted-metrics";
import { scheduleHostedCleanupOutboxWorker } from "./services/hosted-cleanup-outbox";
import { readEntitlements } from "./services/entitlements";
import { academyAuthRateLimit, hookCallRateLimit } from "./services/rate-limits";
import { isElectronLocalApiRequest } from "./request-runtime";

const AGENT_HOOK_PATH = /^\/api\/hooks\/([a-z0-9-]+)$/;
const PROJECT_PATH = /^\/api\/projects\/([^\/]+)$/;
const PROJECT_WORKTREES_PATH = /^\/api\/projects\/([^\/]+)\/worktrees$/;
const PROJECT_WORKTREE_PATH = /^\/api\/projects\/([^\/]+)\/worktrees\/([^\/]+)$/;
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
const REMOTE_PTY_PATH = /^\/api\/remote-pty\/([^\/]+)\/([^\/]+)$/;
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
export const ANONYMOUS_ROUTES: ReadonlyArray<{ method: string; pathname: string }> = [
  { method: "GET", pathname: "/api/academy-auth/login" },
  { method: "GET", pathname: "/api/academy-auth/callback" },
  { method: "GET", pathname: "/api/academy-auth/session" },
  { method: "POST", pathname: "/api/academy-auth/logout" },
];

function isAnonymousRoute(method: string, pathname: string): boolean {
  return ANONYMOUS_ROUTES.some(
    (r) => r.method === method && r.pathname === pathname,
  );
}

const HOSTED_SESSION_OR_BEARER_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/settings$/ },
  { method: "POST", pattern: /^\/api\/settings$/ },
  { method: "GET", pattern: /^\/api\/projects$/ },
  { method: "POST", pattern: /^\/api\/projects$/ },
  { method: "GET", pattern: /^\/api\/projects\/[^/]+$/ },
  { method: "PATCH", pattern: /^\/api\/projects\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/api\/projects\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/projects\/[^/]+\/worktrees$/ },
  { method: "POST", pattern: /^\/api\/projects\/[^/]+\/worktrees$/ },
  { method: "DELETE", pattern: /^\/api\/projects\/[^/]+\/worktrees\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/groups$/ },
  { method: "POST", pattern: /^\/api\/groups$/ },
  { method: "PATCH", pattern: /^\/api\/groups\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/api\/groups\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/projects\/[^/]+\/tasks$/ },
  { method: "POST", pattern: /^\/api\/projects\/[^/]+\/tasks$/ },
  { method: "GET", pattern: /^\/api\/projects\/[^/]+\/user-terminals$/ },
  { method: "POST", pattern: /^\/api\/projects\/[^/]+\/user-terminals$/ },
  { method: "GET", pattern: /^\/api\/tasks\/[^/]+$/ },
  { method: "PATCH", pattern: /^\/api\/tasks\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/api\/tasks\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/status$/ },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/archive$/ },
  { method: "POST", pattern: /^\/api\/tasks\/[^/]+\/restore$/ },
  { method: "PATCH", pattern: /^\/api\/user-terminals\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/api\/user-terminals\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/entitlements$/ },
  { method: "POST", pattern: /^\/api\/events\/ticket$/ },
];

const HOSTED_SESSION_ONLY_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/remote-pty$/ },
  { method: "POST", pattern: /^\/api\/remote-pty\/[^/]+\/(?:write|resize|kill|ticket)$/ },
  { method: "GET", pattern: /^\/api\/remote-pty\/[^/]+\/(?:replay|events)$/ },
];

function matchesRoute(
  routes: ReadonlyArray<{ method: string; pattern: RegExp }>,
  method: string,
  pathname: string,
): boolean {
  return routes.some(
    (route) => route.method === method && route.pattern.test(pathname),
  );
}

function acceptsHostedSessionOrBearer(method: string, pathname: string): boolean {
  return matchesRoute(HOSTED_SESSION_OR_BEARER_ROUTES, method, pathname);
}

function acceptsHostedSessionOnly(method: string, pathname: string): boolean {
  return matchesRoute(HOSTED_SESSION_ONLY_ROUTES, method, pathname);
}

function bearerTokenFromRequest(request: Request): string {
  const auth = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function isHostedSupportRoute(pathname: string): boolean {
  return pathname === "/api/metrics" || pathname.startsWith("/api/support/");
}

const HOOK_AUTH_FAILURE_WINDOW_MS = 60_000;
const HOOK_AUTH_FAILURE_LIMIT = 30;
const hookAuthFailures = new Map<string, { count: number; resetAt: number }>();

function hookAuthRateLimitKey(taskId: string): string {
  return `hook:${taskId || "no-task"}`;
}

function isHookAuthRateLimited(taskId: string): boolean {
  const now = Date.now();
  const keys = ["hook:global", hookAuthRateLimitKey(taskId)];
  return keys.some((key) => {
    const entry = hookAuthFailures.get(key);
    return !!entry && entry.resetAt > now && entry.count >= HOOK_AUTH_FAILURE_LIMIT;
  });
}

function recordHookAuthFailure(taskId: string): void {
  const now = Date.now();
  for (const key of ["hook:global", hookAuthRateLimitKey(taskId)]) {
    const entry = hookAuthFailures.get(key);
    if (!entry || entry.resetAt <= now) {
      hookAuthFailures.set(key, { count: 1, resetAt: now + HOOK_AUTH_FAILURE_WINDOW_MS });
    } else {
      entry.count += 1;
    }
  }
}

/**
 * Centralized auth gate. Default: every /api/* route requires the local bearer
 * token. Hosted-mode web routes may also accept an Academy-backed session.
 * Opt-outs:
 *  - Routes in ANONYMOUS_ROUTES (intentional public auth handoff surface).
 *  - /api/events SSE: EventSource cannot send custom headers, so it uses a
 *    short-lived, single-use ticket issued by POST /api/events/ticket.
 */
async function requireApiAuth(
  request: Request,
  url: URL,
  method: string,
  pathname: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (isAnonymousRoute(method, pathname)) {
    if (
      (pathname === "/api/academy-auth/login" || pathname === "/api/academy-auth/callback") &&
      method === "GET"
    ) {
      const limited = academyAuthRateLimit(request, pathname);
      if (!limited.ok) return limited;
    }
    return { ok: true };
  }
  if (pathname === "/api/events" && method === "GET") return { ok: true };
  if (isHostedDatabaseEnabled() && isHostedSupportRoute(pathname)) {
    return requireBearerTokenValueForSecret(
      bearerTokenFromRequest(request),
      process.env.MC_SUPPORT_API_TOKEN,
    );
  }
  if (isHostedDatabaseEnabled() && AGENT_HOOK_PATH.test(pathname) && method === "POST") {
    if (isElectronLocalApiRequest(request)) return { ok: true };

    const taskId = url.searchParams.get("taskId") ?? "";
    const hookLimited = hookCallRateLimit(request, taskId);
    if (!hookLimited.ok) return hookLimited;
    const hookToken = bearerTokenFromRequest(request);
    if (requireBearerToken(request).ok) {
      recordHookAuthFailure(taskId);
      return { ok: false, response: jsonError(HTTP_UNAUTHORIZED, "unauthorized") };
    }
    const wellFormedHookToken = /^[0-9a-f]{64}$/i.test(hookToken);
    if (!wellFormedHookToken || isHookAuthRateLimited(taskId)) {
      recordHookAuthFailure(taskId);
      return { ok: false, response: jsonError(HTTP_UNAUTHORIZED, "unauthorized") };
    }
    const ok = await validateHostedHookToken(
      taskId,
      hookToken,
    );
    if (ok) return { ok: true };
    recordHookAuthFailure(taskId);
  }

  if (isHostedDatabaseEnabled() && acceptsHostedSessionOnly(method, pathname)) {
    const hosted = await getHostedAuthContext(request);
    if (hosted) return { ok: true };
    return { ok: false, response: jsonError(HTTP_UNAUTHORIZED, "unauthorized") };
  }

  if (isHostedDatabaseEnabled() && acceptsHostedSessionOrBearer(method, pathname)) {
    if (isElectronLocalApiRequest(request)) return { ok: true };

    const hosted = await getHostedAuthContext(request);
    if (hosted) {
      if (pathname === "/api/entitlements") return { ok: true };
      const entitlements = await readEntitlements(hosted);
      if (entitlements.remoteRuntime.allowed) return { ok: true };
      return {
        ok: false,
        response: jsonError(
          HTTP_FORBIDDEN,
          entitlements.remoteRuntime.reason ?? "subscription-required",
        ),
      };
    }

    const bearer = requireBearerToken(request);
    if (bearer.ok) return bearer;
    return { ok: false, response: jsonError(HTTP_UNAUTHORIZED, "unauthorized") };
  }

  const bearer = requireBearerToken(request);
  if (bearer.ok) return bearer;

  return bearer;
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
    const auth = await requireApiAuth(request, url, method, pathname);
    if (!auth.ok) return auth.response;

    try {
      return await fn(request, url, method, pathname);
    } catch (err) {
      const message = redactSensitiveErrorText(errorMessage(err));
      if (isCallerFacingError(err)) return jsonError(HTTP_BAD_REQUEST, message);

      incrementHostedCounter("serverExceptions");
      reportHostedServerException({ method, pathname, message });
      console.error(`[api] unhandled in dispatch ${method} ${pathname}: ${message}`);
      return jsonError(HTTP_INTERNAL_SERVER_ERROR, "internal error");
    }
  };
}

const protectedDispatch = withApiAuth(dispatch);

/** Pure Web `Request → Response` API router for `/api/*`. Reused in dev (Vite middleware) and prod. */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  scheduleHostedCleanupOutboxWorker();
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (!pathname.startsWith("/api/")) return null;
  const requestId = requestHeaderId(request, REQUEST_ID_HEADER) ?? randomUUID();
  const correlationId = requestHeaderId(request, CORRELATION_ID_HEADER) ?? requestId;
  return withHostedLogContext({ requestId, correlationId, method, pathname }, async () => {
    if (pathname === "/api/healthz" && method === "GET") {
      return applyRequestHeaders(await healthController.read(), requestId, correlationId);
    }

    const origin = requireLocalOrigin(request);
    if (!origin.ok) return applyRequestHeaders(origin.response, requestId, correlationId);

    const response = await protectedDispatch(request, url, method, pathname);
    return applyRequestHeaders(response, requestId, correlationId);
  });
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
  let m = pathname.match(PROJECT_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return projectsController.getOne(id, request);
    if (method === "PATCH") return projectsController.update(id, request);
    if (method === "DELETE") return projectsController.remove(id, request);
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
    if (action === "diff" && method === "GET") return gitController.diff(id, url);
    if (action === "stage" && method === "POST") return gitController.stage(id, request);
    if (action === "unstage" && method === "POST") return gitController.unstage(id, request);
    if (action === "commit" && method === "POST") return gitController.commit(id, request);
    if (action === "push" && method === "POST") return gitController.push(id, request);
  }
  m = pathname.match(PROJECT_USER_TERMINALS_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return userTerminalsController.listForProject(id, request);
    if (method === "POST") return userTerminalsController.create(id, request);
  }

  // Groups
  if (pathname === "/api/groups") {
    if (method === "GET") return groupsController.list(request);
    if (method === "POST") return groupsController.create(request);
  }
  m = pathname.match(GROUP_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return groupsController.update(id, request);
    if (method === "DELETE") return groupsController.remove(id, request);
  }

  // Tasks
  m = pathname.match(TASK_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "GET") return tasksController.getOne(id, request);
    if (method === "PATCH") return tasksController.update(id, request);
    if (method === "DELETE") return tasksController.remove(id, request);
  }
  m = pathname.match(TASK_STATUS_PATH);
  if (m && method === "POST") return tasksController.setStatus(decode(m[1]), request);
  m = pathname.match(TASK_ARCHIVE_PATH);
  if (m && method === "POST") return tasksController.archive(decode(m[1]), request);
  m = pathname.match(TASK_RESTORE_PATH);
  if (m && method === "POST") return tasksController.restore(decode(m[1]), request);

  // User terminals
  m = pathname.match(USER_TERMINAL_PATH);
  if (m) {
    const id = decode(m[1]);
    if (method === "PATCH") return userTerminalsController.rename(id, request);
    if (method === "DELETE") return userTerminalsController.remove(id, request);
  }

  // Settings
  if (pathname === "/api/settings") {
    if (method === "GET") return settingsController.read();
    if (method === "POST") return settingsController.update(request);
  }

  // License
  if (pathname === "/api/entitlements" && method === "GET") {
    return entitlementsController.read(request);
  }
  if (pathname === "/api/metrics" && method === "GET") {
    return metricsController.read();
  }
  if (pathname === "/api/support/diagnostics" && method === "GET") {
    return supportController.diagnostics(url);
  }
  if (pathname === "/api/support/cleanup-outbox" && method === "GET") {
    return supportController.cleanupOutbox();
  }
  if (pathname === "/api/support/cleanup-outbox/retry" && method === "POST") {
    return supportController.retryCleanupOutbox(request);
  }
  if (pathname === "/api/support/entitlements/adjust" && method === "POST") {
    return supportController.adjustEntitlement(request);
  }
  if (pathname === "/api/support/entitlements/replay" && method === "POST") {
    return supportController.replayEntitlement(request);
  }
  if (pathname === "/api/support/remote-sessions" && method === "GET") {
    return supportController.activeRemoteSessions();
  }
  if (pathname === "/api/support/runtime-usage" && method === "GET") {
    return supportController.runtimeUsage(url);
  }
  if (pathname === "/api/remote-pty" && method === "POST") {
    return remotePtyController.spawn(request);
  }
  m = pathname.match(REMOTE_PTY_PATH);
  if (m) {
    const ptyId = decode(m[1]);
    const action = m[2]!;
    if (action === "write" && method === "POST") return remotePtyController.write(ptyId, request);
    if (action === "resize" && method === "POST") return remotePtyController.resize(ptyId, request);
    if (action === "kill" && method === "POST") return remotePtyController.kill(ptyId, request);
    if (action === "replay" && method === "GET") return remotePtyController.replay(ptyId, request);
    if (action === "ticket" && method === "POST") return remotePtyController.ticket(ptyId, request);
    if (action === "events" && method === "GET") return remotePtyController.stream(ptyId, request, url);
  }

  // Academy-hosted auth handoff
  if (pathname === "/api/academy-auth/login" && method === "GET") {
    return academyAuthController.login(request);
  }
  if (pathname === "/api/academy-auth/callback" && method === "GET") {
    return academyAuthController.callback(request, url);
  }
  if (pathname === "/api/academy-auth/session" && method === "GET") {
    return academyAuthController.session(request);
  }
  if (pathname === "/api/academy-auth/logout" && method === "POST") {
    return academyAuthController.logout(request);
  }

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
  if (pathname === "/api/events/ticket" && method === "POST") {
    return eventsController.issueTicket(request);
  }
  if (pathname === "/api/events" && method === "GET") return eventsController.stream(url);

  return jsonError(HTTP_NOT_FOUND, "not found");
}

export { mapHookEventToStatus } from "~/shared/agent-hook-events";
