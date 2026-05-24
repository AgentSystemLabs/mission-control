import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-diagram-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask } = await import("../services/tasks");
const { events } = await import("../events");
const { listDiagramsForTask, resetDiagramStoreForTests } = await import("../services/diagram-store");
const { getDb } = await import("~/db/client");
const { projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

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

describe("diagram API", () => {
  let taskId = "";
  let projectId = "";

  beforeEach(() => {
    resetDiagramStoreForTests();
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-diagram-proj-"));
    const project = createProject({ name: "diagram-test", path: dir });
    projectId = project.id;
    const task = createTask({
      projectId,
      title: "Diagram task",
      agent: "claude-code",
    });
    taskId = task.id;
  });

  it("requires taskId and bearer auth", async () => {
    const unauthRes = await handleApiRequest(
      new Request("http://127.0.0.1:5173/api/diagram", {
        method: "POST",
        headers: LOOPBACK_HEADERS,
        body: JSON.stringify({ source: "flowchart LR\n  A --> B" }),
      }),
    );
    expect(unauthRes?.status).toBe(401);

    const missingTaskRes = await handleApiRequest(
      authed("/api/diagram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "flowchart LR\n  A --> B" }),
      }),
    );
    expect(missingTaskRes?.status).toBe(400);
    await expect(missingTaskRes?.json()).resolves.toEqual({ error: "taskId required" });
  });

  it("accepts optional theme metadata with mermaid source", async () => {
    const res = await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "sequenceDiagram\n  A->>B: Hi",
          title: "Sequence",
          format: "mermaid",
          theme: "dark",
        }),
      }),
    );

    expect(res?.status).toBe(200);
    const stored = listDiagramsForTask(taskId);
    expect(stored[0]?.source).toContain("A->>B: Hi");
  });

  it("accepts mermaid source, appends diagrams per task, and emits diagram:show", async () => {
    const seen = vi.fn();
    const off = events.onAny((event) => {
      if (event.type === "diagram:show") seen(event);
    });

    const res = await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "flowchart LR\n  Draft --> POST --> Modal",
          title: "Pipeline",
          format: "mermaid",
        }),
      }),
    );

    off();

    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { ok: boolean; id: string; appended: boolean };
    expect(body.ok).toBe(true);
    expect(body.appended).toBe(true);
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0]?.[0]).toMatchObject({
      type: "diagram:show",
      id: body.id,
      taskId,
      projectId,
      title: "Pipeline",
      source: "flowchart LR\n  Draft --> POST --> Modal",
      format: "mermaid",
      projectName: "diagram-test",
      taskTitle: "Diagram task",
      worktreeId: null,
    });

    const stored = listDiagramsForTask(taskId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toContain("Draft --> POST --> Modal");
  });

  it("appends multiple diagrams for the same task", async () => {
    await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "flowchart LR\n  Old --> Node", title: "First" }),
      }),
    );

    const res = await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "flowchart LR\n  New --> Node", title: "Second" }),
      }),
    );

    expect(res?.status).toBe(200);
    const stored = listDiagramsForTask(taskId);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.source).toContain("Old --> Node");
    expect(stored[1]?.source).toContain("New --> Node");
  });

  it("persists diagrams across module reload (app restart)", async () => {
    await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "flowchart LR\n  A --> B", title: "Latest" }),
      }),
    );

    const { listDiagramsForTask: reloadListDiagrams } = await import("../services/diagram-store");
    expect(reloadListDiagrams(taskId)[0]?.title).toBe("Latest");
  });

  it("lists and reads stored diagrams for a project", async () => {
    await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "flowchart LR\n  A --> B", title: "Latest" }),
      }),
    );

    const listRes = await handleApiRequest(
      authed(`/api/diagrams?projectId=${encodeURIComponent(projectId)}`),
    );
    expect(listRes?.status).toBe(200);
    await expect(listRes?.json()).resolves.toEqual({
      diagrams: [
        expect.objectContaining({
          taskId,
          projectId,
          title: "Latest",
          source: "flowchart LR\n  A --> B",
        }),
      ],
    });

    const readRes = await handleApiRequest(
      authed(`/api/diagram?taskId=${encodeURIComponent(taskId)}`),
    );
    expect(readRes?.status).toBe(200);
    await expect(readRes?.json()).resolves.toEqual({
      diagrams: [
        expect.objectContaining({
          taskId,
          title: "Latest",
        }),
      ],
    });
  });

  it("returns 404 for unknown taskId", async () => {
    const res = await handleApiRequest(
      authed("/api/diagram?taskId=missing-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "flowchart LR\n  A --> B" }),
      }),
    );
    expect(res?.status).toBe(404);
  });
});
