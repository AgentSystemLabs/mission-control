import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-pet-tool-hook-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken, setBooleanSetting } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask } = await import("../services/tasks");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");
const { TITLE_WAITING } = await import("~/lib/task-sentinels");
const { events } = await import("../events");

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

async function postHook(taskId: string, body: Record<string, unknown>): Promise<Response | null> {
  return handleApiRequest(
    authed(`/api/hooks/claude?taskId=${encodeURIComponent(taskId)}`, {
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

function createHookTask() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-pet-tool-proj-"));
  const project = createProject({ name: "pet-tool", path: dir });
  return createTask({
    projectId: project.id,
    title: TITLE_WAITING,
    agent: "claude-code",
    claudeSessionId: SESSION_ID,
  });
}

type EmittedEvent = { type: string; [k: string]: unknown };

describe("pet mid-run tool hook API", () => {
  let taskId = "";
  let captured: EmittedEvent[] = [];
  let off: () => void = () => {};

  beforeEach(() => {
    resetDb();
    taskId = createHookTask().id;
    captured = [];
    off = events.onAny((e) => captured.push(e as EmittedEvent));
  });
  afterEach(() => off());

  const toolUsed = () => captured.find((e) => e.type === "agent:tool-used");

  const postBash = (toolResponse: unknown) =>
    postHook(taskId, {
      hook_event_name: "PostToolUse",
      session_id: SESSION_ID,
      tool_name: "Bash",
      tool_response: toolResponse,
    });

  it("emits a neutral agent:tool-used for a clean result when the pet is on", async () => {
    setBooleanSetting("pet_enabled", true);
    await postBash({ stdout: "All tests passed", stderr: "" });
    const evt = toolUsed();
    expect(evt).toBeDefined();
    expect(evt?.sentiment).toBe("neutral");
    expect(evt?.toolName).toBe("Bash");
    expect(evt?.taskId).toBe(taskId);
  });

  it("classifies an error result as error sentiment", async () => {
    setBooleanSetting("pet_enabled", true);
    await postBash({ stdout: "", stderr: "error: something broke\nexit code 1" });
    expect(toolUsed()?.sentiment).toBe("error");
  });

  it("honors a structured isError flag", async () => {
    setBooleanSetting("pet_enabled", true);
    await postBash({ isError: true, stdout: "looks fine to a regex" });
    expect(toolUsed()?.sentiment).toBe("error");
  });

  it("does not emit anything when the pet is disabled", async () => {
    setBooleanSetting("pet_enabled", false);
    await postBash({ stderr: "error: boom\nexit code 1" });
    expect(toolUsed()).toBeUndefined();
  });

  it("leaves the AskUserQuestion PostToolUse to the status path (no pet event)", async () => {
    setBooleanSetting("pet_enabled", true);
    await postHook(taskId, {
      hook_event_name: "PostToolUse",
      session_id: SESSION_ID,
      tool_name: "AskUserQuestion",
      tool_response: { ok: true },
    });
    expect(toolUsed()).toBeUndefined();
  });
});
