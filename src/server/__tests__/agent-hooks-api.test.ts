import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TaskAgent } from "~/shared/domain";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-agent-hooks-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken, setBooleanSetting } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask, updateStatus } = await import("../services/tasks");
const { createMemory } = await import("../services/project-memory");
const { writeRecallSettings } = await import("../services/recall-settings");
const { resetBriefDeliveries } = await import("../services/brief-delivery");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");
const { TITLE_WAITING } = await import("~/lib/task-sentinels");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };
const SESSION_ID = "00000000-0000-4000-8000-000000000000";

// Some cases shift Date.now past the recent-finish heal window; always restore.
const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

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

describe("background subagents over the claude hook API", () => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    setBooleanSetting("pet_enabled", false);
    taskId = createHookTask("claude-code").id;
  });

  async function prompt(sessionId = SESSION_ID) {
    const res = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      prompt: "run the sweep with background agents",
    });
    expect(res?.status).toBe(200);
  }

  async function subagent(event: "SubagentStart" | "SubagentStop", agentId?: string) {
    const res = await postHook("claude", taskId, {
      hook_event_name: event,
      session_id: SESSION_ID,
      ...(agentId ? { agent_id: agentId } : {}),
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, event });
    return res;
  }

  async function stop(sessionId = SESSION_ID) {
    const res = await postHook("claude", taskId, {
      hook_event_name: "Stop",
      session_id: sessionId,
    });
    expect(res?.status).toBe(200);
    return (await res?.json()) as { status?: string };
  }

  it("holds the session on running while a background subagent is active", async () => {
    await prompt();
    await subagent("SubagentStart", "sub-1");

    // Foreground turn ends while the background subagent still runs.
    const held = await stop();
    expect(held.status).toBe("running");
    expect(getTask(taskId)?.status).toBe("running");

    // Subagent completes; the re-invoked main agent's own Stop is the real finish.
    await subagent("SubagentStop", "sub-1");
    const finished = await stop();
    expect(finished.status).toBe("finished");
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("finishes on Stop when subagents already completed within the turn", async () => {
    await prompt();
    await subagent("SubagentStart", "sub-1");
    await subagent("SubagentStart", "sub-2");
    await subagent("SubagentStop", "sub-1");
    await subagent("SubagentStop", "sub-2");

    const finished = await stop();
    expect(finished.status).toBe("finished");
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("holds until the LAST of several background subagents reports in", async () => {
    await prompt();
    await subagent("SubagentStart", "sub-1");
    await subagent("SubagentStart", "sub-2");
    await subagent("SubagentStop", "sub-1");

    const held = await stop();
    expect(held.status).toBe("running");

    await subagent("SubagentStop", "sub-2");
    const finished = await stop();
    expect(finished.status).toBe("finished");
  });

  it("counts subagents without agent_id via the anonymous fallback", async () => {
    await prompt();
    await subagent("SubagentStart");
    expect((await stop()).status).toBe("running");

    await subagent("SubagentStop");
    expect((await stop()).status).toBe("finished");
  });

  it("does not change task status on subagent lifecycle events themselves", async () => {
    await prompt();
    expect(getTask(taskId)?.status).toBe("running");
    await subagent("SubagentStart", "sub-1");
    expect(getTask(taskId)?.status).toBe("running");
    await subagent("SubagentStop", "sub-1");
    expect(getTask(taskId)?.status).toBe("running");
  });

  it("drops tracked subagents when a new session id is captured", async () => {
    await prompt();
    await subagent("SubagentStart", "sub-1");

    // A new Claude process (fresh session id) means the old session's
    // subagents are gone — its Stop must finish normally.
    const nextSession = "11111111-1111-4111-8111-111111111111";
    await prompt(nextSession);
    const finished = await stop(nextSession);
    expect(finished.status).toBe("finished");
  });

  it("ignores subagent events from a foreign session", async () => {
    await prompt();
    const foreign = "22222222-2222-4222-8222-222222222222";
    const res = await postHook("claude", taskId, {
      hook_event_name: "SubagentStart",
      session_id: foreign,
      agent_id: "foreign-sub",
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ ok: true, ignored: "foreign-session" });

    const finished = await stop();
    expect(finished.status).toBe("finished");
  });

  it("heals a finished task when a late subagent event loses the race to Stop", async () => {
    await prompt();
    // Stop wins the race against the just-launched subagent's SubagentStart.
    expect((await stop()).status).toBe("finished");

    await subagent("SubagentStart", "late-sub");
    expect(getTask(taskId)?.status).toBe("running");

    await subagent("SubagentStop", "late-sub");
    expect((await stop()).status).toBe("finished");
  });

  it("drops tracked subagents on /clear (same session id, background work killed)", async () => {
    await prompt();
    await subagent("SubagentStart", "sub-1");

    const cleared = await postHook("claude", taskId, {
      hook_event_name: "SessionStart",
      session_id: SESSION_ID,
      source: "clear",
    });
    expect(cleared?.status).toBe(200);

    const finished = await stop();
    expect(finished.status).toBe("finished");
  });

  it("drops tracked subagents when the terminal is terminated", async () => {
    await prompt();
    await subagent("SubagentStart", "sub-1");
    updateStatus(taskId, { status: "terminated" });

    // A later session of the same task must not be held by the dead
    // session's never-stopped subagent.
    await prompt();
    const finished = await stop();
    expect(finished.status).toBe("finished");
  });

  it("ignores post-turn helper subagent events on a long-finished task", async () => {
    await prompt();
    expect((await stop()).status).toBe("finished");

    // Minutes later the user refocuses the pane and Claude Code's internal
    // away-summary helper fires SubagentStart/Stop — with no Stop to follow.
    // The finished status must hold (this was the stuck-on-running bug).
    Date.now = () => realNow() + 31_000;
    await subagent("SubagentStart", "away-helper");
    expect(getTask(taskId)?.status).toBe("finished");
    await subagent("SubagentStop", "away-helper");
    expect(getTask(taskId)?.status).toBe("finished");
    Date.now = realNow;

    // The helper's start must not count as active work either — a lost helper
    // stop would otherwise hold the next turn's Stop on running.
    await prompt();
    expect((await stop()).status).toBe("finished");
  });
});

describe("synthetic session-process-exit over the claude hook API", () => {
  let taskId = "";

  beforeEach(() => {
    resetDb();
    setBooleanSetting("pet_enabled", false);
    taskId = createHookTask("claude-code").id;
  });

  async function processExited(exitCode: number) {
    const res = await postHook("claude", taskId, {
      hook_event_name: "MissionControlSessionEnded",
      exit_code: exitCode,
    });
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({
      ok: true,
      event: "MissionControlSessionEnded",
    });
  }

  it("terminates a running task whose process died", async () => {
    updateStatus(taskId, { status: "running" });
    await processExited(137);
    expect(getTask(taskId)?.status).toBe("terminated");
  });

  it("finishes a running task whose process exited cleanly", async () => {
    updateStatus(taskId, { status: "running" });
    await processExited(0);
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("terminates a needs-input task whose process died", async () => {
    updateStatus(taskId, { status: "needs-input" });
    await processExited(1);
    expect(getTask(taskId)?.status).toBe("terminated");
  });

  it("leaves settled tasks alone", async () => {
    updateStatus(taskId, { status: "finished" });
    await processExited(1);
    expect(getTask(taskId)?.status).toBe("finished");

    updateStatus(taskId, { status: "interrupted" });
    await processExited(0);
    expect(getTask(taskId)?.status).toBe("interrupted");
  });

  it("never heals on laggard subagent events after the process died", async () => {
    updateStatus(taskId, { status: "running" });
    // A real Stop lands the finish moments before the process exits…
    const stopped = await postHook("claude", taskId, {
      hook_event_name: "Stop",
      session_id: SESSION_ID,
    });
    expect(stopped?.status).toBe(200);
    await processExited(0);

    // …then an in-flight SubagentStart from the dying session arrives inside
    // what would be the heal window. A dead process can't be re-invoked, so
    // healing here would wedge the task on "running" for the whole TTL.
    const laggard = await postHook("claude", taskId, {
      hook_event_name: "SubagentStart",
      session_id: SESSION_ID,
      agent_id: "laggard",
    });
    expect(laggard?.status).toBe(200);
    expect(getTask(taskId)?.status).toBe("finished");
  });

  it("drops tracked subagents with the dead process", async () => {
    updateStatus(taskId, { status: "running" });
    const started = await postHook("claude", taskId, {
      hook_event_name: "SubagentStart",
      session_id: SESSION_ID,
      agent_id: "orphan",
    });
    expect(started?.status).toBe(200);
    await processExited(1);

    // A later session of the same task must not be held by the dead
    // session's never-stopped subagent.
    const prompted = await postHook("claude", taskId, {
      hook_event_name: "UserPromptSubmit",
      session_id: SESSION_ID,
      prompt: "start again",
    });
    expect(prompted?.status).toBe(200);
    const res = await postHook("claude", taskId, {
      hook_event_name: "Stop",
      session_id: SESSION_ID,
    });
    await expect(res?.json()).resolves.toMatchObject({ status: "finished" });
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
