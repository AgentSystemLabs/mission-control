import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalUserDataDir = process.env.MC_USER_DATA_DIR;
const originalApiToken = process.env.MC_API_TOKEN;
const originalCloudMode = process.env.MC_CLOUD_MODE;
const originalCloudAuthSecret = process.env.MC_CLOUD_AUTH_SECRET;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

afterEach(() => {
  vi.resetModules();
  if (originalUserDataDir === undefined) {
    delete process.env.MC_USER_DATA_DIR;
  } else {
    process.env.MC_USER_DATA_DIR = originalUserDataDir;
  }
  if (originalApiToken === undefined) {
    delete process.env.MC_API_TOKEN;
  } else {
    process.env.MC_API_TOKEN = originalApiToken;
  }
  if (originalCloudMode === undefined) {
    delete process.env.MC_CLOUD_MODE;
  } else {
    process.env.MC_CLOUD_MODE = originalCloudMode;
  }
  if (originalCloudAuthSecret === undefined) {
    delete process.env.MC_CLOUD_AUTH_SECRET;
  } else {
    process.env.MC_CLOUD_AUTH_SECRET = originalCloudAuthSecret;
  }
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalBetterAuthSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
  }
  if (originalBetterAuthUrl === undefined) {
    delete process.env.BETTER_AUTH_URL;
  } else {
    process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
  }
});

describe("SSR API token bootstrap", () => {
  it("entrypoints create the bearer token before route loaders self-fetch API endpoints", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-token-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    delete process.env.MC_API_TOKEN;
    delete process.env.MC_CLOUD_MODE;
    vi.resetModules();

    try {
      const { ensureLocalApiTokenBootstrap } = await import("~/server/bootstrap");
      const { getApiToken, getCachedApiToken } = await import("~/lib/api");

      const bootstrapped = ensureLocalApiTokenBootstrap();
      const token = await getApiToken();

      expect(bootstrapped).toBe(token);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(getCachedApiToken()).toBe(token);
      expect(process.env.MC_API_TOKEN).toBe(token);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not mint or return the local bearer token in cloud mode", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-token-cloud-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    process.env.MC_CLOUD_MODE = "1";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/mission_control";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.BETTER_AUTH_URL = "http://localhost";
    delete process.env.MC_API_TOKEN;
    vi.resetModules();

    try {
      const { ensureLocalApiTokenBootstrap } = await import("~/server/bootstrap");
      const { getApiToken } = await import("~/lib/api");
      const { handleApiRequest } = await import("~/server/api-router");

      expect(ensureLocalApiTokenBootstrap()).toBeNull();
      expect(await getApiToken()).toBe("");

      const response = await handleApiRequest(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ regenerate: true }),
        }),
      );

      expect(response?.status).toBe(401);
      expect(await response?.json()).toEqual({
        error: "unauthorized",
      });
      expect(process.env.MC_API_TOKEN).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not expose the local runtime bearer token over HTTP", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-token-runtime-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    delete process.env.MC_API_TOKEN;
    delete process.env.MC_CLOUD_MODE;
    vi.resetModules();

    try {
      const { handleApiRequest } = await import("~/server/api-router");

      const response = await handleApiRequest(
        new Request("http://localhost/api/runtime/client-token"),
      );

      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ token: null });
      expect(process.env.MC_API_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("lets the local runtime user lookup avoid a first-run auth loop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-runtime-user-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    delete process.env.MC_API_TOKEN;
    delete process.env.MC_CLOUD_MODE;
    vi.resetModules();

    try {
      const { handleApiRequest } = await import("~/server/api-router");

      const response = await handleApiRequest(
        new Request("http://localhost/api/runtime/user"),
      );

      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({
        fullName: "User",
        firstName: "User",
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not expose Daytona-backed runtime operations in local desktop mode", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-runtime-local-disabled-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    delete process.env.MC_API_TOKEN;
    delete process.env.MC_CLOUD_MODE;
    vi.resetModules();

    try {
      const { handleApiRequest } = await import("~/server/api-router");
      const { ensureApiTokenBootstrap } = await import("~/server/bootstrap");
      const token = ensureApiTokenBootstrap();

      const response = await handleApiRequest(
        new Request("http://localhost/api/runtime/pty/spawn", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            taskId: "task-1",
            projectId: "project-1",
            command: "claude",
          }),
        }),
      );

      expect(response?.status).toBe(501);
      expect(await response?.json()).toEqual({
        error: "cloud runtime is disabled in local desktop mode",
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not accept local token auth paths in cloud mode", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-token-cloud-auth-"));
    process.env.MC_USER_DATA_DIR = tmpDir;
    process.env.MC_CLOUD_MODE = "1";
    process.env.MC_CLOUD_AUTH_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/mission_control";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.BETTER_AUTH_URL = "http://localhost";
    delete process.env.MC_API_TOKEN;
    vi.resetModules();

    try {
      const { handleApiRequest } = await import("~/server/api-router");

      const eventsResponse = await handleApiRequest(
        new Request("http://localhost/api/events?t=local-token"),
      );
      const taskResponse = await handleApiRequest(
        new Request("http://localhost/api/tasks/task-1/status", {
          method: "POST",
          headers: {
            authorization: "Bearer v1.task-1.9999999999999.fake",
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "running" }),
        }),
      );
      const hookResponse = await handleApiRequest(
        new Request("http://localhost/api/hooks/stop?taskId=task-1", {
          method: "POST",
          headers: { authorization: "Bearer local-token" },
        }),
      );

      expect(eventsResponse?.status).toBe(401);
      expect(taskResponse?.status).toBe(401);
      expect(hookResponse?.status).toBe(401);
      expect(process.env.MC_API_TOKEN).toBeUndefined();
      const { getSetting } = await import("~/db/settings");
      expect(getSetting("api_token")).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
