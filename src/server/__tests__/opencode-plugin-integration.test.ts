import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  opencodeMissionControlPluginPath,
  writeOpencodeMissionControlPlugin,
} from "~/shared/opencode-mission-control-plugin";
import { TITLE_GENERATING, TITLE_WAITING } from "~/lib/task-sentinels";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-plugin-integration-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

vi.mock("../services/claude-cli", () => ({
  runCli: vi.fn().mockResolvedValue("TITLE: Add dark mode toggle\nICON: palette"),
}));

const { handleApiRequest } = await import("../api-router");
const { installAgentHooks } = await import("../../../electron/agent-hooks");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask } = await import("../services/tasks");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

type OpenCodePluginHooks = {
  event: (ctx: {
    event: { type: string; properties?: Record<string, unknown> };
  }) => Promise<void>;
  "tool.execute.before"?: (input: { tool: string; sessionID?: string }) => Promise<void>;
  "chat.message"?: (
    input: { sessionID: string },
    output: { message: { role: string }; parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>;
};

async function loadMissionControlPluginHooks(
  pluginDir: string,
): Promise<OpenCodePluginHooks> {
  const file = opencodeMissionControlPluginPath(pluginDir);
  const mod = (await import(pathToFileURL(file).href)) as {
    MissionControlStatus: () => Promise<OpenCodePluginHooks>;
  };
  return mod.MissionControlStatus();
}

describe("OpenCode plugin runtime integration", () => {
  let taskId = "";
  let projectDir = "";
  let originalFetch: typeof fetch;

  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();

    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-plugin-proj-"));
    const project = createProject({ name: "opencode-plugin", path: projectDir });
    const task = createTask({
      projectId: project.id,
      title: TITLE_WAITING,
      agent: "opencode",
      claudeSessionId: null,
    });
    taskId = task.id;

    process.env.MC_TASK_ID = taskId;
    process.env.MC_API_URL = "http://127.0.0.1:5173";
    process.env.MC_API_TOKEN = getOrCreateApiToken();

    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const response = await handleApiRequest(
        new Request(url, {
          method: init?.method ?? "GET",
          headers: init?.headers,
          body: init?.body as BodyInit | null | undefined,
        }),
      );
      return response ?? new Response(JSON.stringify({ error: "missing response" }), { status: 500 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MC_TASK_ID;
    delete process.env.MC_API_URL;
    delete process.env.MC_API_TOKEN;
  });

  it("installs the plugin and drives card status through the real hook API", async () => {
    installAgentHooks("opencode", projectDir);
    expect(fs.existsSync(opencodeMissionControlPluginPath(projectDir))).toBe(true);

    const hooks = await loadMissionControlPluginHooks(projectDir);
    const sessionId = "ses_3cf7dd8d4ffeUPfENpVxfFojZ2";

    await hooks.event({
      event: {
        type: "session.created",
        properties: {
          sessionID: sessionId,
          info: { id: sessionId, role: "user" },
        },
      },
    });
    expect(getTask(taskId)).toMatchObject({
      claudeSessionId: sessionId,
      status: "ready",
    });

    await hooks["chat.message"]?.(
      { sessionID: sessionId },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "add dark mode toggle" }],
      },
    );
    expect(getTask(taskId)?.status).toBe("running");

    await hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "idle" } },
      },
    });
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("marks finished on deprecated session.idle events", async () => {
    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);
    const sessionId = "ses_idle_fallback";

    await hooks.event({
      event: {
        type: "session.created",
        properties: { sessionID: sessionId, info: { id: sessionId } },
      },
    });
    await hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "busy" } },
      },
    });
    await hooks.event({
      event: { type: "session.idle", properties: { sessionID: sessionId } },
    });

    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("generates a title from chat.message user prompts", async () => {
    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);
    const sessionId = "ses_title_test_session";

    await hooks.event({
      event: {
        type: "session.created",
        properties: { sessionID: sessionId, info: { id: sessionId } },
      },
    });
    await hooks["chat.message"]?.(
      { sessionID: sessionId },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "add dark mode toggle" }],
      },
    );

    await vi.waitFor(() => {
      const title = getTask(taskId)?.title;
      expect(title).toBeTruthy();
      expect(title).not.toBe(TITLE_WAITING);
      expect(title).not.toBe(TITLE_GENERATING);
    });

    expect(getTask(taskId)).toMatchObject({
      title: "Add dark mode toggle",
      icon: "palette",
    });
  });

  it("does not let non-awaited busy events race the idle finish event", async () => {
    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);
    const sessionId = "ses_non_awaited_status_race";
    const delayedBusyRequests: Array<() => void> = [];

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { hook_event_name?: string; prompt?: string } : {};
      if (body.hook_event_name === "UserPromptSubmit" && !body.prompt) {
        await new Promise<void>((resolve) => delayedBusyRequests.push(resolve));
      }
      const response = await handleApiRequest(
        new Request(url, {
          method: init?.method ?? "GET",
          headers: init?.headers,
          body: init?.body as BodyInit | null | undefined,
        }),
      );
      return response ?? new Response(JSON.stringify({ error: "missing response" }), { status: 500 });
    };

    await hooks.event({
      event: {
        type: "session.created",
        properties: { sessionID: sessionId, info: { id: sessionId } },
      },
    });

    await hooks["chat.message"]?.(
      { sessionID: sessionId },
      {
        message: { role: "user" },
        parts: [{ type: "text", text: "add dark mode toggle" }],
      },
    );
    expect(getTask(taskId)?.status).toBe("running");

    void hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "busy" } },
      },
    });
    void hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: sessionId, status: { type: "idle" } },
      },
    });
    delayedBusyRequests.splice(0).forEach((resolve) => resolve());

    await vi.waitFor(() => {
      expect(getTask(taskId)?.status).toBe("finished");
    });
  });

  it("marks needs-input on permission.asked", async () => {
    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);

    await hooks.event({
      event: {
        type: "permission.asked",
        properties: { sessionID: "ses_perm_test" },
      },
    });

    expect(getTask(taskId)?.status).toBe("needs-input");
  });

  it("marks needs-input when OpenCode asks a built-in question", async () => {
    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);
    const sessionId = "ses_question_test";

    await hooks.event({
      event: {
        type: "question.asked",
        properties: { sessionID: sessionId },
      },
    });

    expect(getTask(taskId)?.status).toBe("needs-input");
  });

  it("marks needs-input before the question tool waits for answers", async () => {
    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);
    const sessionId = "ses_question_tool_test";

    await hooks["tool.execute.before"]?.({ tool: "question", sessionID: sessionId });
    await vi.waitFor(() => {
      expect(getTask(taskId)?.status).toBe("needs-input");
    });
  });

  it("no-ops when Mission Control env vars are missing", async () => {
    delete process.env.MC_TASK_ID;
    delete process.env.MC_API_URL;
    delete process.env.MC_API_TOKEN;

    writeOpencodeMissionControlPlugin(projectDir);
    const hooks = await loadMissionControlPluginHooks(projectDir);

    await hooks.event({
      event: { type: "session.idle", properties: { sessionID: "ses_ignored" } },
    });

    expect(getTask(taskId)).toMatchObject({
      status: "ready",
      claudeSessionId: null,
    });
  });
});
