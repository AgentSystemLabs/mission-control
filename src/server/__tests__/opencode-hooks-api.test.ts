import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-hooks-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask } = await import("../services/tasks");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };

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

describe("OpenCode hook API", () => {
  let taskId = "";

  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-hooks-proj-"));
    const project = createProject({ name: "opencode-hooks", path: dir });
    const task = createTask({
      projectId: project.id,
      title: "Waiting for initial prompt...",
      agent: "opencode",
      claudeSessionId: null,
    });
    taskId = task.id;
  });

  it("captures ses_* session ids from SessionStart without changing status", async () => {
    const sessionId = "ses_3cf7dd8d4ffeUPfENpVxfFojZ2";
    const res = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: sessionId,
        }),
      }),
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, ignored: "SessionStart" });
    expect(getTask(taskId)?.claudeSessionId).toBe(sessionId);
    expect(getTask(taskId)?.status).toBe("ready");
  });

  it("marks tasks finished on Stop", async () => {
    const res = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "Stop",
          session_id: "ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
        }),
      }),
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "finished" });
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("marks tasks running on UserPromptSubmit", async () => {
    const res = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
          prompt: "fix the login bug",
        }),
      }),
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
    expect(getTask(taskId)?.status).toBe("running");
  });

  it("marks tasks needs-input on PermissionRequest", async () => {
    const res = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "PermissionRequest",
          session_id: "ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
        }),
      }),
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "needs-input" });
    expect(getTask(taskId)?.status).toBe("needs-input");
  });

  it("marks tasks needs-input on QuestionRequest", async () => {
    const res = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "QuestionRequest",
          session_id: "ses_question_test",
        }),
      }),
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "needs-input" });
    expect(getTask(taskId)?.status).toBe("needs-input");
  });

  it("walks the full OpenCode hook lifecycle over HTTP", async () => {
    const sessionId = "ses_lifecycle_integration";
    const token = getOrCreateApiToken();

    const sessionStart = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: sessionId,
        }),
      }),
    );
    expect(sessionStart?.status).toBe(200);

    const running = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: sessionId,
          prompt: "ship opencode hooks",
        }),
      }),
    );
    expect(running?.status).toBe(200);

    const finished = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "Stop",
          session_id: sessionId,
        }),
      }),
    );
    expect(finished?.status).toBe(200);

    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: sessionId,
      status: "finished",
    });
    expect(token.length).toBeGreaterThan(0);
  });

  it("ignores status hooks from a different captured session", async () => {
    const capturedSessionId = "ses_captured_session";
    const foreignSessionId = "ses_foreign_session";

    const running = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: capturedSessionId,
          prompt: "ship opencode hooks",
        }),
      }),
    );
    expect(running?.status).toBe(200);
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: capturedSessionId,
      status: "running",
    });

    const foreignStop = await handleApiRequest(
      authed(`/api/hooks/opencode?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "Stop",
          session_id: foreignSessionId,
        }),
      }),
    );

    expect(foreignStop?.status).toBe(200);
    await expect(foreignStop?.json()).resolves.toEqual({ ok: true, ignored: "foreign-session" });
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: capturedSessionId,
      status: "running",
    });
  });
});
