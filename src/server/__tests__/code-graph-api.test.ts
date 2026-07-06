import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-api-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");

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

function makeFixtureProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-graph-api-proj-"));
  fs.writeFileSync(path.join(dir, "core.ts"), `export function core(): number { return 1; }\n`);
  fs.writeFileSync(
    path.join(dir, "a.ts"),
    `import { core } from "./core";\nexport function a(): number { return core(); }\n`,
  );
  return createProject({ name: "graph-api", path: dir }).id;
}

async function waitForIdle(projectId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const res = await handleApiRequest(authed(`/api/projects/${projectId}/graph/status`));
    const body = (await res!.json()) as { status: { indexing: unknown; indexed: boolean } };
    if (!body.status.indexing) return;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe("code graph API", () => {
  let projectId = "";
  beforeAll(async () => {
    projectId = makeFixtureProject();
    const start = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/index?mode=full`, { method: "POST" }),
    );
    expect(start?.status).toBe(202);
    await waitForIdle(projectId);
  });

  it("rejects unauthenticated access", async () => {
    const res = await handleApiRequest(
      new Request(`http://127.0.0.1:5173/api/projects/${projectId}/graph/status`, {
        headers: LOOPBACK_HEADERS,
      }),
    );
    expect(res?.status).toBe(401);
  });

  it("reports an indexed status over HTTP", async () => {
    const res = await handleApiRequest(authed(`/api/projects/${projectId}/graph/status`));
    const body = (await res!.json()) as { status: { indexed: boolean; nodeCount: number } };
    expect(body.status.indexed).toBe(true);
    expect(body.status.nodeCount).toBeGreaterThan(0);
  });

  it("returns a summary with god-nodes", async () => {
    const res = await handleApiRequest(authed(`/api/projects/${projectId}/graph/summary`));
    const body = (await res!.json()) as { summary: { godNodes: unknown[] } };
    expect(Array.isArray(body.summary.godNodes)).toBe(true);
  });

  it("searches nodes by name", async () => {
    const res = await handleApiRequest(authed(`/api/projects/${projectId}/graph/search?q=core`));
    const body = (await res!.json()) as { nodes: Array<{ name: string }> };
    expect(body.nodes.some((n) => n.name === "core")).toBe(true);
  });

  it("inlines verbatim source for top search hits when source=1", async () => {
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/search?q=core&source=1`),
    );
    const body = (await res!.json()) as {
      nodes: Array<{ name: string; source: { text: string; startLine: number } | null }>;
    };
    const hit = body.nodes.find((n) => n.name === "core");
    expect(hit?.source?.text).toContain("export function core(): number { return 1; }");
    expect(hit?.source?.startLine).toBe(1);
  });

  it("omits source from search results by default", async () => {
    const res = await handleApiRequest(authed(`/api/projects/${projectId}/graph/search?q=core`));
    const body = (await res!.json()) as { nodes: Array<Record<string, unknown>> };
    expect(body.nodes[0]).not.toHaveProperty("source");
  });

  it("returns a node's definition source via /graph/node", async () => {
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/node?node=core`),
    );
    const body = (await res!.json()) as {
      node: { name: string; kind: string };
      source: { text: string; truncated: boolean } | null;
    };
    expect(body.node.name).toBe("core");
    expect(body.source?.text).toContain("export function core");
    expect(body.source?.truncated).toBe(false);
  });

  it("404s /graph/node for an unknown symbol", async () => {
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/node?node=definitely-not-a-symbol`),
    );
    expect(res?.status).toBe(404);
  });

  it("returns neighbors for a node", async () => {
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/neighbors?node=${encodeURIComponent("a.ts")}&direction=out`),
    );
    const body = (await res!.json()) as { node: { name: string }; neighbors: unknown[] };
    expect(body.node.name).toBe("a.ts");
    expect(body.neighbors.length).toBeGreaterThan(0);
  });

  it("computes impact for a symbol", async () => {
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/impact?node=core`),
    );
    const body = (await res!.json()) as { dependents: unknown[] };
    expect(body.dependents.length).toBeGreaterThan(0);
  });

  it("404s a cancel when no build is running", async () => {
    const res = await handleApiRequest(
      authed(`/api/projects/${projectId}/graph/index/cancel`, { method: "POST" }),
    );
    expect(res?.status).toBe(409);
  });
});
