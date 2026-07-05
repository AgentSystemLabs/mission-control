import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask } = await import("../services/tasks");
const { getDb } = await import("~/db/client");
const { projectMemory, projects, tasks, groups, appSettings, worktrees } = await import("~/db/schema");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };

function authed(input: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:5173${input}`, {
    ...init,
    headers: {
      ...LOOPBACK_HEADERS,
      authorization: `Bearer ${getOrCreateApiToken()}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-api-proj-"));
  return createProject({ name: "mem-api", path: dir });
}

describe("project memory API", () => {
  let projectId = "";
  beforeEach(() => {
    const db = getDb();
    db.delete(projectMemory).run();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
    projectId = makeProject().id;
  });

  it("creates, lists, and rejects unauthenticated access", async () => {
    const create = await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "stack", title: "Electron + SQLite" }),
      }),
    );
    expect(create?.status).toBe(201);

    const list = await handleApiRequest(authed(`/api/projects/${projectId}/memory`));
    const body = (await list?.json()) as { memories: unknown[] };
    expect(body.memories).toHaveLength(1);

    // No bearer token → unauthorized.
    const noAuth = await handleApiRequest(
      new Request(`http://127.0.0.1:5173/api/projects/${projectId}/memory`, {
        headers: LOOPBACK_HEADERS,
      }),
    );
    expect(noAuth?.status).toBe(401);
  });

  it("updates and deletes a memory via /api/memory/:id", async () => {
    const created = await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "discovery", title: "auth lives in useAuth" }),
      }),
    );
    const { memory } = (await created?.json()) as { memory: { id: string } };

    const patched = await handleApiRequest(
      authed(`/api/memory/${memory.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: true }),
      }),
    );
    expect(((await patched?.json()) as { memory: { pinned: boolean } }).memory.pinned).toBe(true);

    const del = await handleApiRequest(authed(`/api/memory/${memory.id}`, { method: "DELETE" }));
    expect(del?.status).toBe(204);
    const list = await handleApiRequest(authed(`/api/projects/${projectId}/memory`));
    expect(((await list?.json()) as { memories: unknown[] }).memories).toHaveLength(0); // archived
  });

  it("renders a task's Session Brief from its project memory", async () => {
    await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "overview", title: "A CLI-agent mission control app" }),
      }),
    );
    await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "known-issue", title: "warm pool can miss the brief" }),
      }),
    );
    const task = createTask({ projectId, title: "fix warm pool", agent: "claude-code" });

    const res = await handleApiRequest(authed(`/api/tasks/${task.id}/brief`));
    expect(res?.status).toBe(200);
    const { brief, memoryIds } = (await res?.json()) as { brief: string; memoryIds: string[] };
    expect(brief).toContain("# Project memory (Mission Control Recall)");
    expect(brief).toContain("A CLI-agent mission control app");
    expect(brief).toContain("warm pool can miss the brief");
    expect(memoryIds).toHaveLength(2);
  });

  it("returns 404 for a brief of an unknown task", async () => {
    const res = await handleApiRequest(authed(`/api/tasks/does-not-exist/brief`));
    expect(res?.status).toBe(404);
  });

  it("previews a project's brief without needing a task (Recall panel)", async () => {
    await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "overview", title: "a preview-able project" }),
      }),
    );
    const res = await handleApiRequest(authed(`/api/projects/${projectId}/brief`));
    expect(res?.status).toBe(200);
    const { brief } = (await res?.json()) as { brief: string };
    expect(brief).toContain("a preview-able project");
  });

  it("forbids agent-source writes when agent-write is disabled", async () => {
    await handleApiRequest(
      authed(`/api/settings`, {
        method: "POST",
        body: JSON.stringify({ recallAgentWriteEnabled: false }),
      }),
    );
    const create = await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "discovery", title: "agent finding", source: "agent" }),
      }),
    );
    expect(create?.status).toBe(403);
    // A user/manual write is unaffected by the agent-write toggle.
    const manual = await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "discovery", title: "manual finding" }),
      }),
    );
    expect(manual?.status).toBe(201);
  });

  it("verifies a memory via POST /api/memory/:id/verify (engine off → skipped, unchanged)", async () => {
    // Turn the engine off so verification never spawns a CLI — it short-circuits
    // to a `skipped` verdict, which still exercises the route + verdict plumbing.
    await handleApiRequest(
      authed(`/api/settings`, {
        method: "POST",
        body: JSON.stringify({ recallEngineEnabled: false }),
      }),
    );
    const created = await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "stack", title: "Electron + SQLite", confidence: "inferred" }),
      }),
    );
    const { memory } = (await created?.json()) as { memory: { id: string } };

    const res = await handleApiRequest(
      authed(`/api/memory/${memory.id}/verify`, { method: "POST" }),
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { verdict: string; memory: { confidence: string } };
    expect(body.verdict).toBe("skipped");
    expect(body.memory.confidence).toBe("inferred"); // untouched
  });

  it("returns 404 verifying an unknown memory", async () => {
    const res = await handleApiRequest(
      authed(`/api/memory/does-not-exist/verify`, { method: "POST" }),
    );
    expect(res?.status).toBe(404);
  });

  it("returns an empty recorded brief when injection is disabled", async () => {
    await handleApiRequest(
      authed(`/api/projects/${projectId}/memory`, {
        method: "POST",
        body: JSON.stringify({ type: "overview", title: "should not be injected" }),
      }),
    );
    await handleApiRequest(
      authed(`/api/settings`, {
        method: "POST",
        body: JSON.stringify({ recallInjectBriefEnabled: false }),
      }),
    );
    const task = createTask({ projectId, title: "some session", agent: "claude-code" });
    const res = await handleApiRequest(authed(`/api/tasks/${task.id}/brief`));
    expect(res?.status).toBe(200);
    const { brief, memoryIds } = (await res?.json()) as { brief: string; memoryIds: string[] };
    expect(brief).toBe("");
    expect(memoryIds).toHaveLength(0);

    // Previews (record=false) still render so the panel can show what's suppressed.
    const preview = await handleApiRequest(
      authed(`/api/tasks/${task.id}/brief?record=false`),
    );
    const previewBody = (await preview?.json()) as { brief: string };
    expect(previewBody.brief).toContain("should not be injected");
  });
});
