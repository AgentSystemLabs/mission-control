// Live end-to-end of the Recall injection pipeline: a REAL HTTP server (the
// same router prod serves via server-runner.mjs) on an ephemeral port, seeded
// over real `fetch`, then the exact `GET /api/tasks/:id/brief` call the Electron
// main process makes at spawn, then the real managed-block writer against an
// on-disk git repo. Proves the full server→socket→file pipeline the pty-manager
// depends on, minus the Electron process boundary (which is just this fetch).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import http from "node:http";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-recall-live-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getOrCreateApiToken } = await import("../services/settings");
const { createTask } = await import("../services/tasks");
const { writeAgentMemoryFile } = await import("~/shared/agent-memory-file");
const { writeRecallSettings } = await import("../services/recall-settings");

function toWebRequest(req: http.IncomingMessage, host: string): Request {
  const url = `http://${req.headers.host ?? host}${req.url}`;
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
    // @ts-expect-error Node-only duplex option
    duplex: "half",
  });
}

let server: http.Server;
let origin = "";
let token = "";

beforeAll(async () => {
  // Recall ships off by default; enable it so the brief endpoint returns memory.
  writeRecallSettings({ enabled: true });
  token = getOrCreateApiToken();
  server = http.createServer(async (req, res) => {
    try {
      const webRes = await handleApiRequest(toWebRequest(req, "127.0.0.1"));
      if (!webRes) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) Readable.fromWeb(webRes.body as any).pipe(res);
      else res.end();
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function api(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${input}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe("Recall live injection pipeline (real HTTP socket)", () => {
  it("seeds memory over HTTP, fetches the brief over the wire, and writes CLAUDE.local.md", async () => {
    // A real on-disk git project — writeAgentMemoryFile targets its cwd.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-recall-live-proj-"));
    execFileSync("git", ["init", "-q"], { cwd: projectDir });

    // 1) Create the project over real HTTP.
    const projRes = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "recall-live", path: projectDir }),
    });
    expect(projRes.status).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };

    // 2) Add a few typed memories over real HTTP (the Recall create endpoint).
    const memories = [
      { type: "overview", title: "A desktop app that orchestrates CLI coding agents" },
      { type: "stack", title: "Electron + React 19 + TanStack + SQLite/Drizzle" },
      { type: "convention", title: "Server layers: repo → service → controller → router" },
      { type: "known-issue", title: "Warm-pool PTYs spawn before the project is known" },
    ];
    for (const m of memories) {
      const r = await api(`/api/projects/${project.id}/memory`, {
        method: "POST",
        body: JSON.stringify(m),
      });
      expect(r.status).toBe(201);
    }

    // 3) A task = a session. (Fixture via service; the brief fetch below is the
    //    real HTTP call the Electron main process makes at spawn.)
    const task = createTask({
      projectId: project.id,
      title: "investigate warm pool timing",
      agent: "claude-code",
    });

    // 4) The EXACT call electron/agent-memory-brief.ts makes, over a real socket.
    const briefRes = await fetch(`${origin}/api/tasks/${task.id}/brief`, {
      headers: { authorization: `Bearer ${token}`, "X-Mission-Control-Runtime": "electron-local" },
    });
    expect(briefRes.status).toBe(200);
    const { brief, memoryIds } = (await briefRes.json()) as { brief: string; memoryIds: string[] };
    expect(memoryIds.length).toBe(4);

    // 5) The REAL writer drops the managed block into the agent's auto-load file.
    const wrote = writeAgentMemoryFile("claude-code", projectDir, brief);
    expect(wrote).toBe(true);

    const claudeFile = path.join(projectDir, "CLAUDE.local.md");
    const onDisk = fs.readFileSync(claudeFile, "utf8");
    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf8");

    // What actually landed on disk, for eyeball verification in the run output.
    console.log("\n========== CLAUDE.local.md (what the agent auto-loads) ==========\n");
    console.log(onDisk);
    console.log("========== .gitignore ==========\n");
    console.log(gitignore);
    // Prove it's private: git does not see the file.
    const gitStatus = execFileSync("git", ["status", "--porcelain", "--ignored", "CLAUDE.local.md"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trim();
    console.log("========== git status --ignored CLAUDE.local.md ==========\n");
    console.log(gitStatus || "(clean)");
    console.log("\n================================================================\n");

    expect(onDisk).toContain("<!-- mc:recall:start");
    expect(onDisk).toContain("# Project memory (Mission Control Recall)");
    expect(onDisk).toContain("A desktop app that orchestrates CLI coding agents");
    expect(onDisk).toContain("Warm-pool PTYs spawn before the project is known");
    expect(gitignore).toContain("CLAUDE.local.md");
    // `!!` prefix = git-ignored → memory never gets committed.
    expect(gitStatus.startsWith("!!")).toBe(true);
  });
});
