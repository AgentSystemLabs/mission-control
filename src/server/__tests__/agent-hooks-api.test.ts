import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TaskAgent } from "~/shared/domain";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-hooks-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken, setBooleanSetting } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask } = await import("../services/tasks");
const { createMemory } = await import("../services/project-memory");
const { writeRecallSettings } = await import("../services/recall-settings");
const { resetBriefDeliveries } = await import("../services/brief-delivery");
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
    // The pet (on by default) injects its first-turn remark intro as
    // additionalContext; this test pins the bare status response.
    setBooleanSetting("pet_enabled", false);
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
    writeRecallSettings({ enabled: true, proactiveRecallEnabled: true });
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
    // Keep the pet's own first-turn intro out of the frame — this test pins
    // that *recall* injects nothing when disabled.
    setBooleanSetting("pet_enabled", false);
    const res = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "where does authentication happen?",
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
  });

  it("force-loads Recall's deferred MCP tools on the first turn, once per session", async () => {
    // First turn: even an unrelated prompt (no relevant memory) still gets the
    // one-shot ToolSearch instruction so the deferred mem_*/graph_* tools load.
    const first = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "unrelated quantum chromodynamics",
    });
    const firstBody = (await first?.json()) as {
      hookSpecificOutput?: { additionalContext: string };
    };
    expect(firstBody.hookSpecificOutput?.additionalContext).toContain("ToolSearch");
    expect(firstBody.hookSpecificOutput?.additionalContext).toContain(
      "mcp__recall__graph_search",
    );

    // Later turns of the same session must NOT repeat it — the tools are loaded.
    const second = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "where does authentication happen?",
    });
    const secondBody = (await second?.json()) as {
      status: string;
      hookSpecificOutput?: { additionalContext: string };
    };
    expect(secondBody.status).toBe("running");
    // Still surfaces the relevant memory, just without the one-shot tool loader.
    expect(secondBody.hookSpecificOutput?.additionalContext).toContain("useAuth hook");
    expect(secondBody.hookSpecificOutput?.additionalContext).not.toContain("ToolSearch");
  });

  it("does not force-load MCP tools for non-Claude agents", async () => {
    // Same UserPromptSubmit path, but a non-Claude agent whose MCP tools aren't
    // deferred behind ToolSearch — so the one-shot loader must not be injected.
    const codexTask = createHookTask("codex");
    const res = await postHook("codex", codexTask.id, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "unrelated quantum chromodynamics",
    });
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { hookSpecificOutput?: { additionalContext: string } };
    expect(body.hookSpecificOutput?.additionalContext ?? "").not.toContain("ToolSearch");
  });

  it("omits additionalContext on a later turn when nothing is relevant", async () => {
    // Prime the session so the one-shot tool-load nudge is already spent.
    await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "where does authentication happen?",
    });
    const res = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "unrelated quantum chromodynamics",
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
  });
});

describe("SessionStart brief fallback over the hook API", () => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    resetBriefDeliveries();
    const task = createHookTask("claude-code");
    taskId = task.id;
    writeRecallSettings({ enabled: true });
    createMemory({
      projectId: task.projectId,
      type: "overview",
      title: "This app is a session grid for coding agents",
    });
  });

  async function sessionStartContext(source: string): Promise<string> {
    const res = await postHook("claude", taskId, {
      hook_event_name: "SessionStart",
      session_id: SESSION_ID,
      source,
    });
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    };
    return body.hookSpecificOutput?.additionalContext ?? "";
  }

  /** Simulate electron's spawn-time brief fetch (record=true marks delivery). */
  async function fetchSpawnBrief(): Promise<void> {
    const res = await handleApiRequest(
      authed(`/api/tasks/${encodeURIComponent(taskId)}/brief`),
    );
    expect(res?.status).toBe(200);
  }

  it("injects the Session Brief when the spawn-time fetch never happened", async () => {
    const context = await sessionStartContext("startup");
    expect(context).toContain("Project memory (Mission Control Recall)");
    expect(context).toContain("session grid for coding agents");
  });

  it("skips injection when the spawn-time fetch just delivered the brief", async () => {
    await fetchSpawnBrief();
    expect(await sessionStartContext("startup")).toBe("");
  });

  it("re-injects on startup once the recorded delivery predates this spawn", async () => {
    await fetchSpawnBrief();
    const realNow = Date.now;
    // A fresh spawn's fetch happens seconds before SessionStart; a delivery
    // older than the spawn window means this spawn's fetch failed.
    Date.now = () => realNow() + 10 * 60 * 1000;
    try {
      expect(await sessionStartContext("startup")).toContain(
        "session grid for coding agents",
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("skips injection on clear/compact whenever the file channel ever delivered", async () => {
    await fetchSpawnBrief();
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 60 * 1000;
    try {
      // The spawn-time file is still on disk mid-session, however old.
      expect(await sessionStartContext("clear")).toBe("");
      expect(await sessionStartContext("compact")).toBe("");
    } finally {
      Date.now = realNow;
    }
  });

  it("skips injection when brief injection is disabled", async () => {
    writeRecallSettings({ injectBriefEnabled: false });
    expect(await sessionStartContext("startup")).toBe("");
  });

  it("caps the injected brief under the hook-output limit", async () => {
    for (let i = 0; i < 200; i++) {
      createMemory({
        projectId: getTask(taskId)!.projectId,
        type: "overview",
        title: `Oversized memory ${i} with a long descriptive tail to inflate the brief body`,
      });
    }
    const context = await sessionStartContext("startup");
    expect(context.length).toBeGreaterThan(0);
    expect(context.length).toBeLessThanOrEqual(8000);
  });
});
