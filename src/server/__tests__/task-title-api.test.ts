import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-title-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

vi.mock("../services/claude-cli", () => ({
  runCli: vi.fn().mockResolvedValue("TITLE: Generated title\nICON: palette"),
}));

const { runCli } = await import("../services/claude-cli");
const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask, updateTask } = await import("../services/tasks");
const { generateTitleForTask } = await import("../services/title-generator");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");
const { TITLE_WAITING } = await import("~/lib/task-sentinels");

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
  db.delete(tasks).run();
  db.delete(worktrees).run();
  db.delete(projects).run();
  db.delete(groups).run();
  db.delete(appSettings).run();
}

function createTitleTask() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-title-proj-"));
  const project = createProject({ name: "task-title", path: dir });
  return createTask({
    projectId: project.id,
    title: TITLE_WAITING,
    agent: "codex",
  });
}

describe("task title updates", () => {
  beforeEach(() => {
    resetDb();
    vi.mocked(runCli).mockClear();
  });

  it("marks PATCH title updates as manually set", async () => {
    const task = createTitleTask();

    const res = await handleApiRequest(
      authed(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "  Manual session title  " }),
      }),
    );

    expect(res?.status).toBe(200);
    const body = await res!.json();
    expect(body.task.title).toBe("Manual session title");
    expect(body.task.titleManuallySet).toBe(true);
    expect(getTask(task.id)?.titleManuallySet).toBe(true);
  });

  it("does not generate over a manually marked title, even when still sentinel", async () => {
    const task = createTitleTask();
    updateTask(task.id, { titleManuallySet: true });

    await generateTitleForTask(task.id, "add a dark mode toggle");

    expect(runCli).not.toHaveBeenCalled();
    expect(getTask(task.id)).toMatchObject({
      title: TITLE_WAITING,
      titleManuallySet: true,
    });
  });
});
