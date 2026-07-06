import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createProject } = await import("../services/projects");
const { createTask } = await import("../services/tasks");
const { startGraphIndex, isGraphIndexRunning } = await import("../services/code-graph-indexer");
const { listMemory } = await import("../services/project-memory");
const { writeRecallSettings } = await import("../services/recall-settings");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "bundled-mcp", "recall-mcp.mjs");

// Minimal HTTP bridge to the api-router (mirrors electron/server-runner.mjs).
function toWebRequest(req: http.IncomingMessage, port: number): Request {
  const url = `http://127.0.0.1:${port}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v != null) headers.set(k, String(v));
  }
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error duplex is required for streamed bodies in undici
    duplex: "half",
  });
}

let server: http.Server;
let port = 0;
let projectId = "";
let taskId = "";

let fixtureDir = "";

function writeFixture(): string {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mcp-fixture-"));
  fs.writeFileSync(path.join(fixtureDir, "core.ts"), `export function core(): number { return 1; }\n`);
  fs.writeFileSync(
    path.join(fixtureDir, "a.ts"),
    `import { core } from "./core";\nexport function a(): number { return core(); }\n`,
  );
  return fixtureDir;
}

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

beforeAll(async () => {
  // Recall ships off by default; enable it so the agent-write + read tools run.
  writeRecallSettings({ enabled: true });
  projectId = createProject({ name: "mcp-recall", path: writeFixture() }).id;
  taskId = createTask({ projectId, title: "mcp session", agent: "claude-code" }).id;

  startGraphIndex(projectId, "full");
  const deadline = Date.now() + 20_000;
  while (isGraphIndexRunning(projectId)) {
    if (Date.now() > deadline) throw new Error("index timed out");
    await new Promise((r) => setTimeout(r, 25));
  }

  server = http.createServer(async (req, res) => {
    const webRes = await handleApiRequest(toWebRequest(req, port));
    if (!webRes) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await webRes.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connectClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SCRIPT],
    env: {
      PATH: process.env.PATH ?? "",
      MC_API_URL: `http://127.0.0.1:${port}`,
      MC_API_TOKEN: getOrCreateApiToken(),
      MC_TASK_ID: taskId,
    },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("recall MCP server", () => {
  it("exposes both the memory and code-graph tools", async () => {
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "get_neighbors",
        "graph_node",
        "graph_search",
        "impact_of",
        "mem_context",
        "mem_save",
        "mem_search",
        "mem_update",
        "shortest_path",
      ]);
    } finally {
      await client.close();
    }
  });

  it("mem_save persists a memory that a new session would receive", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({
        name: "mem_save",
        arguments: {
          type: "decision",
          title: "Use web-tree-sitter for the code graph",
          body: "vscode grammars load under 0.26 ABI",
        },
      });
      expect(res.isError).toBeFalsy();
      expect(textOf(res)).toContain("Saved to Recall");
      // It's really in the store (source: agent), so future briefs include it.
      const saved = listMemory(projectId).find((m) => m.title.startsWith("Use web-tree-sitter"));
      expect(saved?.source).toBe("agent");
      expect(saved?.type).toBe("decision");
    } finally {
      await client.close();
    }
  });

  it("mem_save surfaces near-duplicate memories for the agent to merge", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({
        name: "mem_save",
        arguments: {
          type: "discovery",
          title: "Code graph parsing uses web-tree-sitter grammars",
        },
      });
      expect(res.isError).toBeFalsy();
      const text = textOf(res);
      expect(text).toContain("Saved to Recall");
      // The decision saved by the previous test is a near-duplicate candidate.
      expect(text).toContain("Possibly related existing memories");
      expect(text).toContain("Use web-tree-sitter for the code graph");
    } finally {
      await client.close();
    }
  });

  it("mem_search finds a saved memory by keyword", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({ name: "mem_search", arguments: { query: "tree-sitter" } });
      const text = textOf(res);
      expect(res.isError).toBeFalsy();
      expect(text).toContain("web-tree-sitter");
      expect(text).toContain("·id:");
    } finally {
      await client.close();
    }
  });

  it("graph_search proxies to the API and returns nodes", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({ name: "graph_search", arguments: { query: "core" } });
      const text = textOf(res);
      expect(res.isError).toBeFalsy();
      expect(text).toContain("core");
      expect(text).toContain("function");
    } finally {
      await client.close();
    }
  });

  it("graph_node returns a symbol's verbatim, line-numbered source", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({ name: "graph_node", arguments: { node: "core" } });
      const text = textOf(res);
      expect(res.isError).toBeFalsy();
      expect(text).toContain("core (function");
      expect(text).toContain("export function core(): number { return 1; }");
      expect(text).toMatch(/^\s+1\t/m); // line-numbered like Read
    } finally {
      await client.close();
    }
  });

  it("graph_search include_source inlines definition bodies", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({
        name: "graph_search",
        arguments: { query: "core", include_source: true },
      });
      const text = textOf(res);
      expect(res.isError).toBeFalsy();
      expect(text).toContain("export function core(): number { return 1; }");
    } finally {
      await client.close();
    }
  });

  it("impact_of reports reverse dependents", async () => {
    const client = await connectClient();
    try {
      const res = await client.callTool({ name: "impact_of", arguments: { node: "core" } });
      expect(textOf(res)).toContain("a");
    } finally {
      await client.close();
    }
  });

  // Mutates the fixture (size-changing edit) — keep last.
  it("banners files changed since the last index on graph results", async () => {
    fs.appendFileSync(path.join(fixtureDir, "core.ts"), `export const extra = 2;\n`);
    const client = await connectClient();
    try {
      const search = await client.callTool({ name: "graph_search", arguments: { query: "core" } });
      expect(textOf(search)).toContain("Changed on disk since the last index");
      expect(textOf(search)).toContain("core.ts");

      const node = await client.callTool({ name: "graph_node", arguments: { node: "core" } });
      expect(textOf(node)).toContain("changed since the last index");
    } finally {
      await client.close();
    }
  });
});
