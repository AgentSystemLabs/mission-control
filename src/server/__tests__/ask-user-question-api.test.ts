import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ask-question-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask } = await import("../services/tasks");
const { getPendingQuestion } = await import("../services/pending-questions");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");
const { TITLE_WAITING } = await import("~/lib/task-sentinels");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };
const SESSION_ID = "00000000-0000-4000-8000-000000000000";
const TOOL_USE_ID = "toolu_test_ask_user_question";

const QUESTION_TOOL_INPUT = {
  questions: [
    {
      question: "What would you like to focus on right now?",
      header: "Next task",
      multiSelect: false,
      options: [
        { label: "Complete the current feature", description: "Finish the modified file" },
        { label: "Review and debug" },
        { label: "Start something new" },
      ],
    },
  ],
};

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
  taskId: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  return handleApiRequest(
    authed(`/api/hooks/claude?taskId=${encodeURIComponent(taskId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function getQuestion(taskId: string): Promise<Response | null> {
  return handleApiRequest(authed(`/api/tasks/${encodeURIComponent(taskId)}/question`));
}

async function postAskUserQuestion(taskId: string): Promise<Response | null> {
  return postHook(taskId, {
    hook_event_name: "PreToolUse",
    session_id: SESSION_ID,
    tool_name: "AskUserQuestion",
    tool_use_id: TOOL_USE_ID,
    tool_input: QUESTION_TOOL_INPUT,
  });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ask-question-proj-"));
  const project = createProject({ name: "ask-question", path: dir });
  return createTask({
    projectId: project.id,
    title: TITLE_WAITING,
    agent: "claude-code",
    claudeSessionId: SESSION_ID,
  });
}

describe("AskUserQuestion hook API", () => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    taskId = createHookTask().id;
  });

  it("stores the question and flips status on PreToolUse", async () => {
    const res = await postAskUserQuestion(taskId);

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "needs-input" });
    expect(getTask(taskId)?.status).toBe("needs-input");

    const stored = getPendingQuestion(taskId);
    expect(stored).toMatchObject({
      id: TOOL_USE_ID,
      taskId,
      questions: [
        {
          question: "What would you like to focus on right now?",
          header: "Next task",
          multiSelect: false,
        },
      ],
    });
    expect(stored?.questions[0]?.options).toHaveLength(3);
  });

  it("serves the pending question over the read endpoint", async () => {
    await postAskUserQuestion(taskId);

    const res = await getQuestion(taskId);
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { question: { id: string } | null };
    expect(body.question?.id).toBe(TOOL_USE_ID);

    const missing = await getQuestion("nope");
    expect(missing?.status).toBe(404);
  });

  it("clears the question and returns to running on PostToolUse", async () => {
    await postAskUserQuestion(taskId);

    const res = await postHook(taskId, {
      hook_event_name: "PostToolUse",
      session_id: SESSION_ID,
      tool_name: "AskUserQuestion",
      tool_use_id: TOOL_USE_ID,
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "running" });
    expect(getTask(taskId)?.status).toBe("running");
    expect(getPendingQuestion(taskId)).toBeNull();
  });

  it.each(["UserPromptSubmit", "Stop"])("clears the question on %s", async (event) => {
    await postAskUserQuestion(taskId);
    expect(getPendingQuestion(taskId)).not.toBeNull();

    const res = await postHook(taskId, {
      hook_event_name: event,
      session_id: SESSION_ID,
    });

    expect(res?.status).toBe(200);
    expect(getPendingQuestion(taskId)).toBeNull();
  });

  it("still flips status when tool_input is malformed, without storing a question", async () => {
    const res = await postHook(taskId, {
      hook_event_name: "PreToolUse",
      session_id: SESSION_ID,
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "", options: [] }, "garbage"] },
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, status: "needs-input" });
    expect(getPendingQuestion(taskId)).toBeNull();
  });

  it("ignores PreToolUse for other tools", async () => {
    const res = await postHook(taskId, {
      hook_event_name: "PreToolUse",
      session_id: SESSION_ID,
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, ignored: "PreToolUse" });
    expect(getPendingQuestion(taskId)).toBeNull();
    expect(getTask(taskId)?.status).not.toBe("needs-input");
  });

  it("ignores questions from foreign sessions", async () => {
    const res = await postHook(taskId, {
      hook_event_name: "PreToolUse",
      session_id: "11111111-1111-4111-8111-111111111111",
      tool_name: "AskUserQuestion",
      tool_input: QUESTION_TOOL_INPUT,
    });

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, ignored: "foreign-session" });
    expect(getPendingQuestion(taskId)).toBeNull();
  });
});
