import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-pet-tool-hook-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken, setBooleanSetting } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask, updateStatus } = await import("../services/tasks");
const { setPendingQuestion, getPendingQuestion } = await import("../services/pending-questions");
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

  it("heals a stale needs-input task back to running when a tool runs", async () => {
    setBooleanSetting("pet_enabled", true);
    // The task is parked in needs-input with a pending question (as after an
    // AskUserQuestion answered via "Chat about this", which fires no
    // AskUserQuestion PostToolUse to move it on).
    updateStatus(taskId, { status: "needs-input" });
    setPendingQuestion({
      taskId,
      projectId: getTask(taskId)!.projectId,
      questions: [],
    });

    await postBash({ stdout: "ok", stderr: "" });

    // The tool proves the agent resumed: status is running again and the stale
    // question cleared (which fires task:question-cleared for the overlay/pet).
    expect(getTask(taskId)?.status).toBe("running");
    expect(getPendingQuestion(taskId)).toBeNull();
    expect(captured.some((e) => e.type === "task:question-cleared")).toBe(true);
    // Still a normal mid-run pet signal.
    expect(toolUsed()?.taskId).toBe(taskId);
  });

  it("leaves a running task's status untouched on a tool hook", async () => {
    setBooleanSetting("pet_enabled", true);
    updateStatus(taskId, { status: "running" });
    await postBash({ stdout: "ok", stderr: "" });
    expect(getTask(taskId)?.status).toBe("running");
  });

  it("classifies what the tool did and carries it as kind", async () => {
    setBooleanSetting("pet_enabled", true);
    await postBash({
      stdout: "[main 3fa9c21] feat: pet hooks\n 2 files changed, 40 insertions(+)",
      stderr: "",
    });
    const evt = toolUsed();
    expect(evt?.kind).toBe("commit");
    expect(evt?.sentiment).toBe("success");
  });

  it("classifies edited files by kind", async () => {
    setBooleanSetting("pet_enabled", true);
    await postHook(taskId, {
      hook_event_name: "PostToolUse",
      session_id: SESSION_ID,
      tool_name: "Edit",
      tool_input: { file_path: "src/styles.css" },
      tool_response: {},
    });
    const evt = toolUsed();
    expect(evt?.kind).toBe("edit-styles");
    expect(evt?.sentiment).toBe("neutral");
  });

  const toolUsedEvents = () => captured.filter((e) => e.type === "agent:tool-used");

  it("throttles a burst of neutral tool signals to one per task", async () => {
    setBooleanSetting("pet_enabled", true);
    // Three routine neutral results back-to-back — only the first is spoken;
    // the rest are inside the server-side neutral cooldown.
    await postBash({ stdout: "ok", stderr: "" });
    await postBash({ stdout: "still ok", stderr: "" });
    await postBash({ stdout: "fine", stderr: "" });
    expect(toolUsedEvents()).toHaveLength(1);
  });

  it("never throttles a meaningful result behind a neutral one", async () => {
    setBooleanSetting("pet_enabled", true);
    // A neutral edit spends the cooldown, then a passing-tests run lands inside
    // it — the meaningful success must still reach the pet (the old shell gate
    // dropped exactly this).
    await postBash({ stdout: "ok", stderr: "" });
    await postBash({ stdout: "vitest: 1636 passed", stderr: "" });
    const events = toolUsedEvents();
    expect(events).toHaveLength(2);
    expect(events[1].sentiment).toBe("success");
    expect(events[1].kind).toBe("tests-pass");
  });
});

describe("pet remark channel (Stop hook)", () => {
  let taskId = "";
  let captured: EmittedEvent[] = [];
  let off: () => void = () => {};
  // Transcript containment pins paths to the real ~/.claude/projects.
  const claudeProjects = path.join(os.homedir(), ".claude", "projects");
  const transcriptFile = path.join(claudeProjects, "mc-pet-remark-api-test.jsonl");

  beforeEach(() => {
    resetDb();
    taskId = createHookTask().id;
    captured = [];
    off = events.onAny((e) => captured.push(e as EmittedEvent));
    fs.mkdirSync(claudeProjects, { recursive: true });
  });
  afterEach(() => {
    off();
    fs.rmSync(transcriptFile, { force: true });
  });

  const writeTranscript = (assistantText: string) => {
    fs.writeFileSync(
      transcriptFile,
      [
        JSON.stringify({ type: "user", message: { content: "do the thing" } }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: assistantText }] },
        }),
      ].join("\n") + "\n",
    );
  };

  const postStop = () =>
    postHook(taskId, {
      hook_event_name: "Stop",
      session_id: SESSION_ID,
      transcript_path: transcriptFile,
    });

  const postStopWithMessage = (lastAssistantMessage: string) =>
    postHook(taskId, {
      hook_event_name: "Stop",
      session_id: SESSION_ID,
      transcript_path: transcriptFile,
      last_assistant_message: lastAssistantMessage,
    });

  it("speaks Claude's cue before the finish event", async () => {
    setBooleanSetting("pet_enabled", true);
    writeTranscript("All green. <!-- pet: the suite purrs -->");
    await postStop();

    const remarkIdx = captured.findIndex((e) => e.type === "agent:remark");
    const finishIdx = captured.findIndex((e) => e.type === "session:finished");
    expect(remarkIdx).toBeGreaterThanOrEqual(0);
    expect(captured[remarkIdx].text).toBe("the suite purrs");
    expect(finishIdx).toBeGreaterThan(remarkIdx);
  });

  it("prefers the payload's last_assistant_message over the transcript", async () => {
    setBooleanSetting("pet_enabled", true);
    // The transcript lags with an older turn's cue; the hook payload carries
    // THIS turn's fresh cue — the pet must speak the fresh one.
    writeTranscript("Older turn. <!-- pet: stale line -->");
    await postStopWithMessage("Fresh turn. <!-- pet: fresh line -->");

    const remark = captured.find((e) => e.type === "agent:remark");
    expect(remark?.text).toBe("fresh line");
  });

  it("falls back to the transcript when no last_assistant_message is present", async () => {
    setBooleanSetting("pet_enabled", true);
    writeTranscript("Done. <!-- pet: from transcript -->");
    await postStop();
    expect(captured.find((e) => e.type === "agent:remark")?.text).toBe("from transcript");
  });

  it("stays silent without a cue, when repeated, and when the pet is off", async () => {
    setBooleanSetting("pet_enabled", true);
    writeTranscript("Done, no cue here.");
    await postStop();
    expect(captured.some((e) => e.type === "agent:remark")).toBe(false);

    // A cue is spoken once; the same turn re-firing Stop must not repeat it.
    writeTranscript("Done. <!-- pet: once only -->");
    await postStop();
    await postStop();
    expect(captured.filter((e) => e.type === "agent:remark")).toHaveLength(1);

    captured.length = 0;
    setBooleanSetting("pet_enabled", false);
    writeTranscript("Done. <!-- pet: nobody home -->");
    await postStop();
    expect(captured.some((e) => e.type === "agent:remark")).toBe(false);
  });
});

describe("pet remark intro (first-turn instruction)", () => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    taskId = createHookTask().id;
  });

  const postPrompt = (sessionId: string) =>
    postHook(taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      prompt: "please fix the bug",
    });

  it("introduces the pet once per session when enabled", async () => {
    setBooleanSetting("pet_enabled", true);
    const sessionId = crypto.randomUUID();
    const first = await (await postPrompt(sessionId))!.json();
    const context = first?.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("<!-- pet:");

    const second = await (await postPrompt(sessionId))!.json();
    const secondContext = second?.hookSpecificOutput?.additionalContext ?? "";
    expect(secondContext).not.toContain("<!-- pet:");
  });

  it("does not introduce the pet when disabled", async () => {
    setBooleanSetting("pet_enabled", false);
    const body = await (await postPrompt(crypto.randomUUID()))!.json();
    const context = body?.hookSpecificOutput?.additionalContext ?? "";
    expect(context).not.toContain("<!-- pet:");
  });
});
