import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PromptSearchResult } from "~/shared/prompts";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prompts-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

// generateTitleForTask (invoked alongside capture) shells out to a CLI; stub it.
vi.mock("../services/claude-cli", () => ({
  runCli: vi.fn().mockResolvedValue("TITLE: Generated\nICON: palette"),
}));

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask } = await import("../services/tasks");
const { getDb } = await import("~/db/client");
const { prompts, tasks, projects, groups, worktrees } = await import("~/db/schema");

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

function resetDb() {
  const db = getDb();
  db.delete(prompts).run();
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
}

function makeTask(title = "session") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-prompts-api-proj-"));
  const project = createProject({ name: "acme", path: dir });
  const task = createTask({ projectId: project.id, title, agent: "claude-code" });
  return { project, task };
}

async function submitPrompt(taskId: string, prompt: string) {
  return handleApiRequest(
    authed(`/api/hooks/claude-code?taskId=${taskId}&hookEvent=UserPromptSubmit`, {
      method: "POST",
      body: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt,
        session_id: "session-1",
      }),
    }),
  );
}

async function search(q: string): Promise<PromptSearchResult[]> {
  const res = await handleApiRequest(authed(`/api/prompts?q=${encodeURIComponent(q)}`));
  expect(res?.status).toBe(200);
  const body = (await res!.json()) as { prompts: PromptSearchResult[] };
  return body.prompts;
}

describe("prompt capture + search API", () => {
  beforeEach(() => {
    resetDb();
  });

  it("records a UserPromptSubmit hook and makes it searchable", async () => {
    const { project, task } = makeTask("Session One");
    const res = await submitPrompt(task.id, "wire up the dark mode toggle");
    expect(res?.status).toBe(200);

    const results = await search("dark mode");
    expect(results).toHaveLength(1);
    expect(results[0]!.taskId).toBe(task.id);
    expect(results[0]!.projectId).toBe(project.id);
    expect(results[0]!.text).toBe("wire up the dark mode toggle");
    expect(results[0]!.taskTitle).toBe("Session One");
    expect(results[0]!.projectName).toBe("acme");
  });

  it("does not double-store the same submission", async () => {
    const { task } = makeTask();
    await submitPrompt(task.id, "identical prompt");
    await submitPrompt(task.id, "identical prompt");
    expect(await search("identical")).toHaveLength(1);
  });

  it("returns recent prompts when the query is empty", async () => {
    const { task } = makeTask();
    await submitPrompt(task.id, "some earlier request");
    const results = await search("");
    expect(results.map((r) => r.text)).toContain("some earlier request");
  });
});
