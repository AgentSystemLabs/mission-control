import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-auth-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest, ANONYMOUS_ROUTES, redactSensitiveErrorText } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { resetRateLimitsForTests } = await import("../services/rate-limits");
const { resetHostedMetricsForTests } = await import("../services/hosted-metrics");
const { MISSION_CONTROL_RUNTIME_HEADER } = await import("../../shared/runtime");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };

function unauth(input: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:5173${input}`, {
    ...init,
    headers: { ...LOOPBACK_HEADERS, ...(init.headers as Record<string, string> | undefined) },
  });
}

function authed(input: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:5173${input}`, {
    ...init,
    headers: {
      ...LOOPBACK_HEADERS,
      authorization: `Bearer ${getOrCreateApiToken()}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function electronAuthed(input: string, init: RequestInit = {}): Request {
  return authed(input, {
    ...init,
    headers: {
      [MISSION_CONTROL_RUNTIME_HEADER]: "electron-local",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

// Representative routes pulled from src/server/api-router.ts:dispatch — one
// per controller, covering GET, POST, PATCH, DELETE, PUT shapes. Each entry
// asserts the auth gate triggers without auth (401) and lets a local Electron
// bearer call through (anything other than 401, since 200/400/404 all mean the
// gate let dispatch run).
const PROTECTED_ROUTES: ReadonlyArray<{ method: string; pathname: string }> = [
  // Projects
  { method: "GET", pathname: "/api/projects" },
  { method: "POST", pathname: "/api/projects" },
  { method: "GET", pathname: "/api/projects/abc" },
  { method: "PATCH", pathname: "/api/projects/abc" },
  { method: "DELETE", pathname: "/api/projects/abc" },
  { method: "DELETE", pathname: "/api/projects/abc/file?path=foo" },
  // Project tasks
  { method: "GET", pathname: "/api/projects/abc/tasks" },
  { method: "POST", pathname: "/api/projects/abc/tasks" },
  // Git
  { method: "GET", pathname: "/api/projects/abc/git/status" },
  { method: "POST", pathname: "/api/projects/abc/git/stage" },
  { method: "POST", pathname: "/api/projects/abc/git/commit" },
  { method: "POST", pathname: "/api/projects/abc/git/push" },
  // User terminals
  { method: "GET", pathname: "/api/projects/abc/user-terminals" },
  { method: "POST", pathname: "/api/projects/abc/user-terminals" },
  { method: "PATCH", pathname: "/api/user-terminals/xyz" },
  { method: "DELETE", pathname: "/api/user-terminals/xyz" },
  // Groups
  { method: "GET", pathname: "/api/groups" },
  { method: "POST", pathname: "/api/groups" },
  { method: "PATCH", pathname: "/api/groups/g1" },
  { method: "DELETE", pathname: "/api/groups/g1" },
  // Tasks
  { method: "GET", pathname: "/api/tasks/t1" },
  { method: "PATCH", pathname: "/api/tasks/t1" },
  { method: "DELETE", pathname: "/api/tasks/t1" },
  { method: "POST", pathname: "/api/tasks/t1/status" },
  { method: "POST", pathname: "/api/tasks/t1/archive" },
  { method: "POST", pathname: "/api/tasks/t1/restore" },
  // Settings
  { method: "GET", pathname: "/api/settings" },
  { method: "POST", pathname: "/api/settings" },
  // License
  { method: "GET", pathname: "/api/license" },
  { method: "GET", pathname: "/api/entitlements" },
  { method: "GET", pathname: "/api/metrics" },
  { method: "GET", pathname: "/api/support/diagnostics?academyUserId=academy-user-1" },
  { method: "GET", pathname: "/api/support/cleanup-outbox" },
  { method: "POST", pathname: "/api/support/cleanup-outbox/retry" },
  { method: "POST", pathname: "/api/support/entitlements/adjust" },
  { method: "POST", pathname: "/api/support/entitlements/replay" },
  { method: "GET", pathname: "/api/support/remote-sessions" },
  { method: "GET", pathname: "/api/support/runtime-usage" },
  { method: "DELETE", pathname: "/api/license" },
  { method: "POST", pathname: "/api/license/validate" },
  // Skills
  { method: "GET", pathname: "/api/skills/install/installed" },
  { method: "GET", pathname: "/api/skills/install/latest" },
  { method: "POST", pathname: "/api/skills/install" },
  // Launch kit
  { method: "GET", pathname: "/api/launch-kit/access" },
  { method: "POST", pathname: "/api/launch-kit/projects" },
  // Keybindings
  { method: "GET", pathname: "/api/keybindings" },
  { method: "PUT", pathname: "/api/keybindings" },
  { method: "DELETE", pathname: "/api/keybindings" },
  // Hooks — the slugs production actually emits (see electron/agent-hooks.ts
  // and electron/pty-manager.ts) plus a synthetic one to cover the route
  // shape independently of the production slug set.
  { method: "POST", pathname: "/api/hooks/claude" },
  { method: "POST", pathname: "/api/hooks/codex" },
  { method: "POST", pathname: "/api/hooks/cursor" },
  { method: "POST", pathname: "/api/hooks/claude-code" },
  // Usage
  { method: "GET", pathname: "/api/usage" },
  // SSE ticket issuance
  { method: "POST", pathname: "/api/events/ticket" },
];

describe("api auth gate", () => {
  // Snapshots the explicit anonymous allow-list — the only way a route can
  // bypass bearer auth. CI must fail on any addition so a human approves it.
  it("anonymous allow-list only contains Academy auth handoff routes", () => {
    expect(ANONYMOUS_ROUTES).toEqual([
      { method: "GET", pathname: "/api/academy-auth/login" },
      { method: "GET", pathname: "/api/academy-auth/callback" },
      { method: "GET", pathname: "/api/academy-auth/session" },
      { method: "POST", pathname: "/api/academy-auth/logout" },
    ]);
  });

  it("redacts sensitive query credentials before errors become response text", () => {
    expect(
      redactSensitiveErrorText("failed /api/events?token=abc123&x=1 /api/events?ticket=def456"),
    ).toBe("failed /api/events?token=<redacted>&x=1 /api/events?ticket=<redacted>");
  });

  it("handleApiRequest reaches routes only through the protected dispatch wrapper", () => {
    const src = handleApiRequest.toString();
    expect(src).toContain("protectedDispatch(");
    expect(src).not.toMatch(/[^A-Za-z0-9_]dispatch\(/);
  });

  it("serves public health checks before origin and bearer auth", async () => {
    const res = await handleApiRequest(
      new Request("http://127.0.0.1:5173/api/healthz", {
        headers: { origin: "https://health-check.example" },
      }),
    );
    expect(res?.status).toBe(200);
    const body = await res!.json() as {
      ok: boolean;
      status: string;
      checks: { api: string; database: string };
    };
    expect(body).toMatchObject({
      ok: true,
      status: "ok",
      checks: { api: "ok", database: "disabled" },
    });
  });

  it("adds request and correlation ids to API responses", async () => {
    const res = await handleApiRequest(
      unauth("/api/healthz", {
        headers: {
          "x-request-id": "req-test-1",
          "x-correlation-id": "corr-test-1",
        },
      }),
    );
    expect(res?.headers.get("x-request-id")).toBe("req-test-1");
    expect(res?.headers.get("x-correlation-id")).toBe("corr-test-1");
  });

  for (const route of PROTECTED_ROUTES) {
    it(`${route.method} ${route.pathname} requires bearer`, async () => {
      const res = await handleApiRequest(unauth(route.pathname, { method: route.method }));
      expect(res?.status).toBe(401);
    });

    it(`${route.method} ${route.pathname} lets bearered requests reach dispatch`, async () => {
      const res = await handleApiRequest(authed(route.pathname, { method: route.method }));
      // Anything other than 401 means the gate let the call through; 400/404
      // from downstream validation/lookups is expected for these synthetic ids.
      expect(res?.status).not.toBe(401);
    });
  }

  describe("/api/events SSE", () => {
    it("rejects without ?ticket=", async () => {
      const res = await handleApiRequest(unauth("/api/events", { method: "GET" }));
      expect(res?.status).toBe(401);
    });

    it("rejects with a wrong ?ticket=", async () => {
      const res = await handleApiRequest(unauth("/api/events?ticket=nope", { method: "GET" }));
      expect(res?.status).toBe(401);
    });

    it("rejects the old long-lived ?token= bearer path", async () => {
      const token = getOrCreateApiToken();
      const res = await handleApiRequest(
        unauth(`/api/events?token=${encodeURIComponent(token)}`, { method: "GET" }),
      );
      expect(res?.status).toBe(401);
    });

    it("ignores the Authorization header (EventSource can't send one)", async () => {
      // The SSE path reads only ?ticket=; passing a correct Authorization
      // header but no ticket should still 401, so we don't accidentally permit
      // two authentication paths drifting in the future.
      const res = await handleApiRequest(authed("/api/events", { method: "GET" }));
      expect(res?.status).toBe(401);
    });

    it("accepts with a freshly issued single-use ?ticket=", async () => {
      const ticketRes = await handleApiRequest(
        authed("/api/events/ticket", { method: "POST" }),
      );
      expect(ticketRes?.status).toBe(200);
      const body = await ticketRes!.json() as { ticket: string; expiresAt: number };
      expect(body.ticket).toMatch(/^[0-9a-f]{64}$/);
      expect(body.expiresAt).toBeGreaterThan(Date.now());

      const res = await handleApiRequest(
        unauth(`/api/events?ticket=${encodeURIComponent(body.ticket)}`, { method: "GET" }),
      );
      // SSE returns 200 with a streaming body.
      expect(res?.status).toBe(200);
      expect(res?.headers.get("content-type")).toMatch(/event-stream/i);
      // Don't actually consume the stream — Vitest would hang.
      await res?.body?.cancel();

      const reused = await handleApiRequest(
        unauth(`/api/events?ticket=${encodeURIComponent(body.ticket)}`, { method: "GET" }),
      );
      expect(reused?.status).toBe(401);
    });
  });

  it("still 403s cross-origin before checking bearer", async () => {
    const token = getOrCreateApiToken();
    const res = await handleApiRequest(
      new Request("http://127.0.0.1:5173/api/projects", {
        headers: {
          origin: "https://evil.com",
          authorization: `Bearer ${token}`,
        },
      }),
    );
    expect(res?.status).toBe(403);
  });

  it("returns auth-required remote entitlements without a hosted Academy session", async () => {
    const res = await handleApiRequest(authed("/api/entitlements", { method: "GET" }));
    expect(res?.status).toBe(200);
    const body = await res!.json() as {
      entitlements: { remoteRuntime: { allowed: boolean; reason: string } };
    };
    expect(body.entitlements.remoteRuntime.allowed).toBe(false);
    expect(body.entitlements.remoteRuntime.reason).toBe("auth-required");
  });

  it("routes local Electron bearer requests to SQLite when hosted DB env and cookies exist", async () => {
    process.env.DATABASE_URL = "postgres://hosted-test";
    try {
      const anonymous = await handleApiRequest(unauth("/api/projects", { method: "GET" }));
      expect(anonymous?.status).toBe(401);

      const bearer = await handleApiRequest(
        electronAuthed("/api/projects", {
          method: "GET",
          headers: { cookie: "mc_session=stale-hosted-session" },
        }),
      );
      expect(bearer?.status).toBe(200);
      const body = await bearer!.json() as { projects: unknown[] };
      expect(Array.isArray(body.projects)).toBe(true);

      const entitlements = await handleApiRequest(
        electronAuthed("/api/entitlements", {
          method: "GET",
          headers: { cookie: "mc_session=stale-hosted-session" },
        }),
      );
      expect(entitlements?.status).toBe(200);
      const entitlementBody = await entitlements!.json() as {
        entitlements: { hosted: { enabled: boolean } };
      };
      expect(entitlementBody.entitlements.hosted.enabled).toBe(false);
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it("keeps hosted auth, bearer auth, Academy handoff codes, and hook tokens scoped to their routes", async () => {
    process.env.DATABASE_URL = "postgres://hosted-test";
    try {
      const bearerCannotStartRemoteRuntime = await handleApiRequest(
        authed("/api/remote-pty", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "hp-1", cwd: "/home/workspace", command: "pwd" }),
        }),
      );
      expect(bearerCannotStartRemoteRuntime?.status).toBe(401);
      expect(await bearerCannotStartRemoteRuntime!.json()).toEqual({ error: "unauthorized" });

      const hostedCookieCannotUseSupportApi = await handleApiRequest(
        unauth("/api/support/diagnostics?academyUserId=academy-user-1", {
          headers: { cookie: "mc_session=fake-hosted-session" },
        }),
      );
      expect(hostedCookieCannotUseSupportApi?.status).toBe(401);

      const genericBearerCannotUseHostedSupportApi = await handleApiRequest(
        authed("/api/support/remote-sessions", { method: "GET" }),
      );
      expect(genericBearerCannotUseHostedSupportApi?.status).toBe(401);

      process.env.MC_SUPPORT_API_TOKEN = "support-token-1";
      const supportBearerCanUseHostedSupportApi = await handleApiRequest(
        unauth("/api/support/remote-sessions", {
          method: "GET",
          headers: { authorization: "Bearer support-token-1" },
        }),
      );
      expect(supportBearerCanUseHostedSupportApi?.status).toBe(200);

      const academyCodeCannotListProjects = await handleApiRequest(
        unauth("/api/projects?code=academy-code-1", { method: "GET" }),
      );
      expect(academyCodeCannotListProjects?.status).toBe(401);

      const hookToken = "a".repeat(64);
      const hookTokenCannotListProjects = await handleApiRequest(
        unauth("/api/projects", {
          method: "GET",
          headers: { authorization: `Bearer ${hookToken}` },
        }),
      );
      expect(hookTokenCannotListProjects?.status).toBe(401);

      const bearerCannotReplaceHostedHookToken = await handleApiRequest(
        authed("/api/hooks/claude?taskId=ht-1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
        }),
      );
      expect(bearerCannotReplaceHostedHookToken?.status).toBe(401);

      const hostedCookieCannotReplaceHostedHookToken = await handleApiRequest(
        unauth("/api/hooks/claude?taskId=ht-1", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "mc_session=fake-hosted-session",
          },
          body: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
        }),
      );
      expect(hostedCookieCannotReplaceHostedHookToken?.status).toBe(401);
    } finally {
      delete process.env.DATABASE_URL;
      delete process.env.MC_SUPPORT_API_TOKEN;
    }
  });

  it("exposes protected hosted metrics", async () => {
    resetHostedMetricsForTests();
    const res = await handleApiRequest(authed("/api/metrics", { method: "GET" }));
    expect(res?.status).toBe(200);
    const body = await res!.json() as {
      metrics: {
        counters: Record<string, number>;
        gauges: Record<string, number>;
        uptimeSeconds: number;
      };
    };
    expect(body.metrics.counters).toMatchObject({
      academyEntitlementSyncFailures: 0,
      cleanupFailures: 0,
      hookFailures: 0,
      remotePtyFailures: 0,
      remotePtyStarts: 0,
      serverExceptions: 0,
    });
    expect(body.metrics.gauges).toMatchObject({ activeRemotePtys: 0 });
    expect(body.metrics.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("does not expose the removed Better Auth API surface", async () => {
    const res = await handleApiRequest(
      unauth("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Hosted User",
          email: `hosted-${Date.now()}@example.com`,
          password: "password123",
        }),
      }),
    );
    expect(res?.status).toBe(401);
  });

  it("allows same-origin Academy session checks without the Electron bearer", async () => {
    const res = await handleApiRequest(unauth("/api/academy-auth/session", { method: "GET" }));
    expect(res?.status).toBe(200);
    const body = await res!.json() as { hostedEnabled: boolean; authenticated: boolean };
    expect(body).toMatchObject({ hostedEnabled: false, authenticated: true });
  });

  it("rate-limits Academy auth handoff attempts", async () => {
    resetRateLimitsForTests();
    process.env.MC_AUTH_RATE_LIMIT_PER_MINUTE = "1";
    try {
      expect((await handleApiRequest(unauth("/api/academy-auth/login", { method: "GET" })))?.status)
        .toBe(302);
      const limited = await handleApiRequest(unauth("/api/academy-auth/login", { method: "GET" }));
      expect(limited?.status).toBe(429);
      expect(limited?.headers.get("retry-after")).toBeTruthy();
    } finally {
      delete process.env.MC_AUTH_RATE_LIMIT_PER_MINUTE;
      resetRateLimitsForTests();
    }
  });

  it("can disable hosted remote runtime globally", async () => {
    process.env.MC_REMOTE_RUNTIME_DISABLED = "true";
    try {
      const res = await handleApiRequest(
        authed("/api/remote-pty", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "hp-1", cwd: "/home/workspace", command: "pwd" }),
        }),
      );
      expect(res?.status).toBe(503);
      expect(await res!.json()).toEqual({ error: "remote runtime disabled" });
    } finally {
      delete process.env.MC_REMOTE_RUNTIME_DISABLED;
    }
  });
});
