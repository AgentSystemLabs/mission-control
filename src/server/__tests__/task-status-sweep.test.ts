import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import type { TaskStatus } from "~/shared/domain";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-sweep-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask, getTask, sweepOrphanedActiveTasks } = await import("../services/tasks");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

function authed(input: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:5173${input}`, {
    ...init,
    headers: {
      origin: "http://127.0.0.1:5173",
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

describe("orphaned task status sweep", () => {
  let projectId = "";

  beforeEach(() => {
    resetDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sweep-proj-"));
    projectId = createProject({ name: "sweep", path: dir }).id;
  });

  function makeTask(status: TaskStatus): string {
    const t = createTask({ projectId, title: "t", agent: "claude-code", status });
    return t.id;
  }

  it("disconnects local tasks stuck in active statuses, leaves settled ones", () => {
    const running = makeTask("running");
    const waiting = makeTask("needs-input");
    const finished = makeTask("finished");
    const ready = makeTask("ready");

    expect(sweepOrphanedActiveTasks()).toBe(2);

    expect(getTask(running)?.status).toBe("disconnected");
    expect(getTask(waiting)?.status).toBe("disconnected");
    expect(getTask(finished)?.status).toBe("finished");
    expect(getTask(ready)?.status).toBe("ready");
  });

  it("leaves sandbox-scoped tasks alone — their sessions survive app restarts", () => {
    const remote = makeTask("running");
    // createTask normalizes unknown scopes to local, so flip the row directly
    // to model a sandbox-scoped task.
    getDb().update(tasks).set({ scopeId: "sbx-remote" }).where(eq(tasks.id, remote)).run();

    expect(sweepOrphanedActiveTasks()).toBe(0);
    expect(getTask(remote)?.status).toBe("running");
  });

  it("is exposed at POST /api/tasks/sweep-disconnected", async () => {
    const running = makeTask("running");
    const res = await handleApiRequest(
      authed("/api/tasks/sweep-disconnected", { method: "POST" }),
    );
    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toEqual({ swept: 1 });
    expect(getTask(running)?.status).toBe("disconnected");
  });
});
