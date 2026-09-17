import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scratch-pads-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { getDb } = await import("~/db/client");
const { scratchPads, projects, groups, worktrees } = await import("~/db/schema");
const { SCRATCH_PAD_CONTENT_MAX } = await import("~/shared/scratch-pads");

const LOOPBACK_HEADERS = { origin: "http://127.0.0.1:5173" };

type PadView = { id: string; content: string; createdAt: number; updatedAt: number };

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

function makeProject(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scratch-pads-proj-"));
  return createProject({ name, path: dir });
}

// Writes in these tests can land in the same Date.now() millisecond, which
// would leave updatedAt-desc ordering to an unspecified tie-break.
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 2));
}

async function createPad(projectId: string, content: string) {
  const res = await handleApiRequest(
    authed(`/api/projects/${projectId}/scratch-pads`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  );
  expect(res?.status).toBe(201);
  return ((await res?.json()) as { scratchPad: PadView }).scratchPad;
}

async function listPads(projectId: string): Promise<PadView[]> {
  const res = await handleApiRequest(authed(`/api/projects/${projectId}/scratch-pads`));
  expect(res?.status).toBe(200);
  return ((await res?.json()) as { scratchPads: PadView[] }).scratchPads;
}

describe("scratch pads API", () => {
  let projectId = "";
  beforeEach(() => {
    const db = getDb();
    db.delete(scratchPads).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    projectId = makeProject("pads-api").id;
  });

  it("creates, orders by updatedAt desc, and rejects unauthenticated access", async () => {
    const a = await createPad(projectId, "pad A");
    await tick();
    const b = await createPad(projectId, "pad B");
    await tick();
    const c = await createPad(projectId, "pad C");
    await tick();

    // Touch the MIDDLE pad: [B, C, A] differs from insertion order, creation
    // order, and reverse-creation order — only updatedAt-desc produces it.
    const touched = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads/${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "pad B, edited" }),
      }),
    );
    expect(touched?.status).toBe(200);
    const patchedBody = ((await touched?.json()) as { scratchPad: PadView }).scratchPad;
    expect(patchedBody.content).toBe("pad B, edited");
    expect(patchedBody.updatedAt).toBeGreaterThan(patchedBody.createdAt);

    const listed = await listPads(projectId);
    expect(listed.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
    expect(listed[0]!.updatedAt).toBeGreaterThan(listed[1]!.updatedAt);
    expect(listed[1]!.updatedAt).toBeGreaterThan(listed[2]!.updatedAt);

    const noAuth = await handleApiRequest(
      new Request(`http://127.0.0.1:5173/api/projects/${projectId}/scratch-pads`, {
        headers: LOOPBACK_HEADERS,
      }),
    );
    expect(noAuth?.status).toBe(401);
  });

  it("defaults omitted content to empty and allows clearing a pad", async () => {
    const created = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(created?.status).toBe(201);
    const pad = ((await created?.json()) as { scratchPad: PadView }).scratchPad;
    expect(pad.content).toBe("");

    // Clearing an existing pad (content: "") is a supported edit, not a 400.
    await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads/${pad.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "something" }),
      }),
    );
    const cleared = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads/${pad.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "" }),
      }),
    );
    expect(cleared?.status).toBe(200);
    expect((await listPads(projectId))[0]!.content).toBe("");
  });

  it("scopes pads per project — foreign lists and cross-project item access", async () => {
    const otherProjectId = makeProject("pads-api-other").id;
    const pad = await createPad(projectId, "belongs to project A");

    const otherList = await listPads(otherProjectId);
    expect(otherList).toHaveLength(0);

    // Addressing project A's pad through project B reads as not-found.
    const crossPatch = await handleApiRequest(
      authed(`/api/projects/${otherProjectId}/scratch-pads/${pad.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "hijack" }),
      }),
    );
    expect(crossPatch?.status).toBe(404);
    const crossDelete = await handleApiRequest(
      authed(`/api/projects/${otherProjectId}/scratch-pads/${pad.id}`, { method: "DELETE" }),
    );
    expect(crossDelete?.status).toBe(404);

    // The pad is untouched under its own project.
    const list = await listPads(projectId);
    expect(list).toHaveLength(1);
    expect(list[0]!.content).toBe("belongs to project A");
  });

  it("deletes a pad and 404s on unknown project or pad", async () => {
    const pad = await createPad(projectId, "temporary");
    const del = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads/${pad.id}`, { method: "DELETE" }),
    );
    expect(del?.status).toBe(204);
    expect(await listPads(projectId)).toHaveLength(0);

    const unknownProjectList = await handleApiRequest(
      authed(`/api/projects/nope/scratch-pads`),
    );
    expect(unknownProjectList?.status).toBe(404);

    const unknownProjectCreate = await handleApiRequest(
      authed(`/api/projects/nope/scratch-pads`, {
        method: "POST",
        body: JSON.stringify({ content: "x" }),
      }),
    );
    expect(unknownProjectCreate?.status).toBe(404);

    const unknownPad = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads/nope`, { method: "DELETE" }),
    );
    expect(unknownPad?.status).toBe(404);
  });

  it("rejects content over the size cap on create and update", async () => {
    const oversized = "x".repeat(SCRATCH_PAD_CONTENT_MAX + 1);
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads`, {
        method: "POST",
        body: JSON.stringify({ content: oversized }),
      }),
    );
    expect(res?.status).toBe(400);

    const pad = await createPad(projectId, "small");
    const patch = await handleApiRequest(
      authed(`/api/projects/${projectId}/scratch-pads/${pad.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: oversized }),
      }),
    );
    expect(patch?.status).toBe(400);
    expect((await listPads(projectId))[0]!.content).toBe("small");
  });
});
