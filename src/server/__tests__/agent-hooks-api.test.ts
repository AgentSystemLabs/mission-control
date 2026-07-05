import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TaskAgent } from "~/shared/domain";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-hooks-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask } = await import("../services/tasks");
const { createMemory } = await import("../services/project-memory");
const { writeRecallSettings } = await import("../services/recall-settings");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");
const { TITLE_WAITING } = await import("~/lib/task-sentinels");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };
const SESSION_ID = "00000000-0000-4000-8000-000000000000";

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

async function postHook(
  slug: string,
  taskId: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  return handleApiRequest(
    authed(`/api/hooks/${slug}?taskId=${encodeURIComponent(taskId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function resetDb() {
  const db = getDb();
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
  db.delete(appSettings).run();
}

function createHookTask(agent: TaskAgent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mc-${agent}-hooks-proj-`));
  const project = createProject({ name: `${agent}-hooks`, path: dir });
  return createTask({
    projectId: project.id,
    title: TITLE_WAITING,
    agent,
    claudeSessionId: null,
  });
}

describe.each([
  { agent: "claude-code" as const, slug: "claude" },
  { agent: "codex" as const, slug: "codex" },
])("$agent hook API", ({ agent, slug }) => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    taskId = createHookTask(agent).id;
  });

  it("marks tasks running on UserPromptSubmit", async () => {
    const res = await postHook(slug, taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "fix the login bug",
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
    expect(getTask(taskId)?.status).toBe("running");
  });

  it("captures session ids from UserPromptSubmit", async () => {
    const res = await postHook(slug, taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "wire hook tests",
    });

    expect(res?.status).toBe(200);
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: SESSION_ID,
      status: "running",
    });
  });

  it("marks tasks finished on Stop", async () => {
    const res = await postHook(slug, taskId, {
      hook_event_name: "Stop",
      session_id: SESSION_ID,
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "finished" });
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("marks tasks needs-input on PermissionRequest", async () => {
    const res = await postHook(slug, taskId, {
      hook_event_name: "PermissionRequest",
      session_id: SESSION_ID,
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "needs-input" });
    expect(getTask(taskId)?.status).toBe("needs-input");
  });

  it("walks the full hook lifecycle over HTTP", async () => {
    const running = await postHook(slug, taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "ship agent hook coverage",
    });
    expect(running?.status).toBe(200);

    const finished = await postHook(slug, taskId, {
      hook_event_name: "Stop",
      session_id: SESSION_ID,
    });
    expect(finished?.status).toBe(200);

    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: SESSION_ID,
      status: "finished",
    });
  });
});

describe("cursor-cli hook API", () => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    taskId = createHookTask("cursor-cli").id;
  });

  it("marks tasks running on beforeSubmitPrompt", async () => {
    const res = await postHook("cursor", taskId, {
      hook_event_name: "beforeSubmitPrompt",
      session_id: SESSION_ID,
      prompt: "fix the login bug",
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
    expect(getTask(taskId)?.status).toBe("running");
  });

  it("captures session ids from beforeSubmitPrompt", async () => {
    const res = await postHook("cursor", taskId, {
      hook_event_name: "beforeSubmitPrompt",
      session_id: SESSION_ID,
      prompt: "wire hook tests",
    });

    expect(res?.status).toBe(200);
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: SESSION_ID,
      status: "running",
    });
  });

  it("captures conversation ids from beforeSubmitPrompt", async () => {
    const res = await postHook("cursor", taskId, {
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: SESSION_ID,
      prompt: "wire hook tests",
    });

    expect(res?.status).toBe(200);
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: SESSION_ID,
      status: "running",
    });
  });

  it("captures conversation ids from sessionStart", async () => {
    const res = await postHook("cursor", taskId, {
      hook_event_name: "sessionStart",
      conversation_id: SESSION_ID,
    });

    expect(res?.status).toBe(200);
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: SESSION_ID,
    });
  });

  it("marks tasks finished on stop", async () => {
    const res = await postHook("cursor", taskId, {
      hook_event_name: "stop",
      session_id: SESSION_ID,
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "finished" });
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("marks tasks finished on afterAgentResponse", async () => {
    const res = await postHook("cursor", taskId, {
      hook_event_name: "afterAgentResponse",
      session_id: SESSION_ID,
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "finished" });
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("walks the full hook lifecycle over HTTP", async () => {
    const running = await postHook("cursor", taskId, {
      hook_event_name: "beforeSubmitPrompt",
      session_id: SESSION_ID,
      prompt: "ship agent hook coverage",
    });
    expect(running?.status).toBe(200);

    const finished = await postHook("cursor", taskId, {
      hook_event_name: "afterAgentResponse",
      session_id: SESSION_ID,
    });
    expect(finished?.status).toBe(200);

    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: SESSION_ID,
      status: "finished",
    });
  });
});

describe("proactive per-turn recall over the hook API", () => {
  let taskId = "";
  let projectId = "";

  beforeEach(() => {
    resetDb();
    const task = createHookTask("claude-code");
    taskId = task.id;
    projectId = task.projectId;
    writeRecallSettings({ proactiveRecallEnabled: true });
    createMemory({
      projectId,
      type: "architecture",
      title: "Authentication lives in the useAuth hook",
    });
  });

  it("returns relevant memory as additionalContext on UserPromptSubmit", async () => {
    const res = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "where does authentication happen?",
    });
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      status: string;
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    };
    expect(body.status).toBe("running");
    expect(body.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(body.hookSpecificOutput?.additionalContext).toContain("useAuth hook");
  });

  it("omits additionalContext when proactive recall is disabled", async () => {
    writeRecallSettings({ proactiveRecallEnabled: false });
    const res = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "where does authentication happen?",
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
  });

  it("omits additionalContext when nothing is relevant", async () => {
    const res = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "unrelated quantum chromodynamics",
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
  });
});
