import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-auth-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest, ANONYMOUS_ROUTES, redactSensitiveErrorText } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");

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
  { method: "PATCH", pathname: "/api/projects/pinned-order" },
  { method: "DELETE", pathname: "/api/projects/abc" },
  { method: "DELETE", pathname: "/api/projects/abc/file?path=foo" },
  // Project tasks
  { method: "GET", pathname: "/api/projects/abc/tasks" },
  { method: "POST", pathname: "/api/projects/abc/tasks" },
  // Git
  { method: "GET", pathname: "/api/projects/abc/git/status" },
  { method: "GET", pathname: "/api/projects/abc/git/branches" },
  { method: "POST", pathname: "/api/projects/abc/git/stage" },
  { method: "POST", pathname: "/api/projects/abc/git/commit" },
  { method: "POST", pathname: "/api/projects/abc/git/push" },
  { method: "POST", pathname: "/api/projects/abc/git/checkout" },
  { method: "POST", pathname: "/api/projects/abc/git/create-pr" },
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
  { method: "DELETE", pathname: "/api/license" },
  { method: "POST", pathname: "/api/license/validate" },
  // Diagram skill
  { method: "GET", pathname: "/api/skills/install/diagram/installed" },
  { method: "POST", pathname: "/api/skills/install/diagram" },
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
  { method: "POST", pathname: "/api/hooks/opencode" },
  { method: "POST", pathname: "/api/hooks/claude-code" },
  { method: "GET", pathname: "/api/diagram" },
  { method: "POST", pathname: "/api/diagram" },
  { method: "GET", pathname: "/api/diagrams" },
  // Usage
  { method: "GET", pathname: "/api/usage" },
  // SSE ticket issuance
  { method: "POST", pathname: "/api/events/ticket" },
];

describe("api auth gate", () => {
  // Snapshots the explicit anonymous allow-list — the only way a route can
  // bypass bearer auth. CI must fail on any addition so a human approves it.
  it("anonymous allow-list is empty", () => {
    expect(ANONYMOUS_ROUTES).toEqual([]);
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

  it("does not expose the removed Better Auth API surface", async () => {
    const res = await handleApiRequest(
      unauth("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Local User",
          email: `local-${Date.now()}@example.com`,
          password: "password123",
        }),
      }),
    );
    expect(res?.status).toBe(401);
  });
});
