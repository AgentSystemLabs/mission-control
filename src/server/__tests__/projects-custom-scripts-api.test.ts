import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-custom-scripts-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getDb } = await import("~/db/client");
const { projects } = await import("~/db/schema");
const { getOrCreateApiToken } = await import("../services/settings");
const { insertProject } = await import("../repositories/projects.repo");
const { parseCustomScripts } = await import("~/shared/domain");

async function body(res: Response | null | undefined) {
  return (await res!.json()) as Record<string, any>;
}

function electronRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${getOrCreateApiToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${input}`, { ...init, headers });
}

let counter = 0;
function makeProject(): string {
  const id = `p-cs-${++counter}`;
  const now = Date.now();
  insertProject({
    id,
    name: id,
    path: `/tmp/${id}`,
    icon: "PR",
    iconColor: "#fff",
    imagePath: null,
    groupId: null,
    sandboxId: null,
    pinned: false,
    pinnedOrder: null,
    branch: "main",
    launchCommands: null,
    customScripts: null,
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    defaultGridView: false,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function patch(id: string, payload: unknown) {
  return handleApiRequest(
    electronRequest(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  );
}

describe("PATCH /api/projects/:id customScripts", () => {
  beforeEach(() => {
    getDb().delete(projects).run();
  });

  it("persists well-formed scripts in order", async () => {
    const id = makeProject();
    const scripts = [
      { id: "a", name: "Test", command: "pnpm test" },
      { id: "b", name: "Build", command: "pnpm build" },
    ];
    const res = await patch(id, { customScripts: scripts });
    expect(res!.status).toBe(200);
    const { project } = await body(res);
    expect(parseCustomScripts(project.customScripts)).toEqual(scripts);
  });

  it("clears scripts when given an empty array", async () => {
    const id = makeProject();
    await patch(id, {
      customScripts: [{ id: "a", name: "Test", command: "pnpm test" }],
    });
    const res = await patch(id, { customScripts: [] });
    expect(res!.status).toBe(200);
    const { project } = await body(res);
    expect(project.customScripts).toBeNull();
  });

  it("rejects more than the max number of scripts", async () => {
    const id = makeProject();
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      command: `cmd${i}`,
    }));
    const res = await patch(id, { customScripts: tooMany });
    expect(res!.status).toBe(400);
  });

  it("rejects a script missing its name", async () => {
    const id = makeProject();
    const res = await patch(id, {
      customScripts: [{ id: "a", command: "pnpm test" }],
    });
    expect(res!.status).toBe(400);
  });

  it("rejects a script missing its command", async () => {
    const id = makeProject();
    const res = await patch(id, {
      customScripts: [{ id: "a", name: "Test" }],
    });
    expect(res!.status).toBe(400);
  });

  it("persists declared args round-trip", async () => {
    const id = makeProject();
    const scripts = [
      {
        id: "a",
        name: "Deploy",
        command: "lpd deploy --env $ENV",
        args: [{ name: "ENV", description: "Environment to deploy to" }],
      },
    ];
    const res = await patch(id, { customScripts: scripts });
    expect(res!.status).toBe(200);
    const { project } = await body(res);
    expect(parseCustomScripts(project.customScripts)).toEqual(scripts);
  });

  it("rejects an arg with an invalid name", async () => {
    const id = makeProject();
    const res = await patch(id, {
      customScripts: [
        {
          id: "a",
          name: "Deploy",
          command: "deploy $bad",
          args: [{ name: "1bad" }],
        },
      ],
    });
    expect(res!.status).toBe(400);
  });

  it("leaves customScripts untouched when the patch omits the field", async () => {
    const id = makeProject();
    await patch(id, {
      customScripts: [{ id: "a", name: "Test", command: "pnpm test" }],
    });
    const res = await patch(id, { name: "renamed" });
    expect(res!.status).toBe(200);
    const { project } = await body(res);
    expect(project.name).toBe("renamed");
    expect(parseCustomScripts(project.customScripts)).toEqual([
      { id: "a", name: "Test", command: "pnpm test" },
    ]);
  });
});
