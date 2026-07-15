import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sandboxes-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { handleApiRequest } = await import("../api-router");
const { getDb } = await import("~/db/client");
const { sandboxes, projects, appSettings, tasks, userTerminals, homeTerminals } = await import("~/db/schema");
const { getOrCreateApiToken } = await import("../services/settings");
const { insertProject } = await import("../repositories/projects.repo");
const { insertSandbox } = await import("../repositories/sandboxes.repo");
const { eq } = await import("drizzle-orm");

async function body(res: Response | null | undefined) {
  return (await res!.json()) as Record<string, any>;
}

function electronRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${getOrCreateApiToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${input}`, { ...init, headers });
}

let sbCounter = 0;

/**
 * Seed a remote-VM sandbox row directly. AWS sandboxes are provisioned by the
 * Electron deploy CLI (which writes the row to SQLite), so the HTTP API has no
 * create route — tests seed the row the same way the CLI would.
 */
function seedRemoteSandbox(
  name: string,
  opts: { remoteConfig?: string | null; pairingToken?: string | null } = {},
): string {
  const id = `sb-test-${++sbCounter}`;
  const now = Date.now();
  insertSandbox({
    id,
    name,
    kind: "remote-vm",
    color: null,
    imageTag: null,
    dockerfilePath: null,
    buildArgs: null,
    gitAuthMode: "none",
    copyAgentCreds: false,
    declaredPorts: null,
    env: null,
    hostAgentPort: null,
    portMap: null,
    pairingToken: opts.pairingToken ?? null,
    remoteConfig: opts.remoteConfig ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function makeProject(id: string, sandboxId: string | null) {
  const now = Date.now();
  insertProject({
    id,
    name: id,
    path: `/tmp/${id}`,
    icon: "PR",
    iconColor: "#fff",
    imagePath: null,
    groupId: null,
    sandboxId,
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
}

describe("sandboxes API", () => {
  beforeEach(() => {
    getDb().delete(homeTerminals).run();
    getDb().delete(userTerminals).run();
    getDb().delete(tasks).run();
    getDb().delete(projects).run();
    getDb().delete(sandboxes).run();
    getDb().delete(appSettings).run();
  });

  it("lists seeded sandboxes and selects the active scope", async () => {
    const id = seedRemoteSandbox("Flexion");

    const list = await body(await handleApiRequest(electronRequest("/api/sandboxes")));
    expect(list.sandboxes.map((s: any) => s.id)).toContain(id);

    const active = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes/active", { method: "PUT", body: JSON.stringify({ scopeId: id }) }),
      ),
    );
    expect(active.activeScopeId).toBe(id);
    expect((await body(await handleApiRequest(electronRequest("/api/sandboxes")))).activeScopeId).toBe(id);
  });

  it("updates per-sandbox config and returns only the public sandbox shape", async () => {
    const id = seedRemoteSandbox("Flexion", { pairingToken: "secret-token" });

    getDb()
      .update(sandboxes)
      .set({ portMap: JSON.stringify({ 5173: 15173 }) })
      .where(eq(sandboxes.id, id))
      .run();

    const updated = await body(
      await handleApiRequest(
        electronRequest(`/api/sandboxes/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            imageTag: "acme/sandbox:dev",
            dockerfilePath: "/repo/Dockerfile",
            gitAuthMode: "copy-host",
            buildArgs: {
              NODE_VERSION: "22",
              "bad-key": "ignored",
            },
            declaredPorts: [5173, 3000, 5173],
          }),
        }),
      ),
    );

    expect(updated.sandbox).toMatchObject({
      id,
      imageTag: "acme/sandbox:dev",
      dockerfilePath: "/repo/Dockerfile",
      gitAuthMode: "copy-host",
      buildArgKeys: ["NODE_VERSION"],
      hasBuildArgs: true,
      declaredPorts: [3000, 5173],
      hasPairingToken: true,
      hasPortMap: true,
    });
    expect(updated.sandbox.pairingToken).toBeUndefined();
    expect(updated.sandbox.portMap).toBeUndefined();

    const listed = await body(await handleApiRequest(electronRequest("/api/sandboxes")));
    expect(listed.sandboxes[0].pairingToken).toBeUndefined();
    expect(listed.sandboxes[0].portMap).toBeUndefined();
    expect(listed.sandboxes[0].buildArgs).toBeUndefined();
    expect(listed.sandboxes[0].buildArgKeys).toEqual(["NODE_VERSION"]);
  });

  it("reveals the saved API key for a remote VM sandbox", async () => {
    const id = seedRemoteSandbox("Client", {
      pairingToken: "0123456789abcdef0123456789abcdef",
      remoteConfig: JSON.stringify({ agentUrl: "wss://agent.example.com/" }),
    });

    const revealed = await body(
      await handleApiRequest(electronRequest(`/api/sandboxes/${id}/api-key`)),
    );
    expect(revealed).toEqual({ apiKey: "0123456789abcdef0123456789abcdef" });
  });

  it("deleting a sandbox cascade-deletes its projects, scoped rows, and resets the active scope to Local", async () => {
    const id = seedRemoteSandbox("Client");
    makeProject("p-local", null);
    makeProject("p-client", id);
    const now = Date.now();
    getDb()
      .insert(tasks)
      .values({
        id: "t-scoped",
        projectId: "p-local",
        worktreeId: null,
        scopeId: id,
        title: "Scoped task",
        icon: null,
        agent: "claude-code",
        status: "ready",
        branch: "main",
        preview: "",
        lines: 0,
        archived: false,
        pinned: false,
        claudeSessionId: null,
        claudeSkipPermissions: false,
        claudeBareSession: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    getDb()
      .insert(userTerminals)
      .values({
        id: "ut-scoped",
        projectId: "p-local",
        worktreeId: null,
        scopeId: id,
        name: "Sandbox shell",
        cwd: "/tmp/p-local",
        startCommand: null,
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    getDb()
      .insert(homeTerminals)
      .values({
        id: "ht-scoped",
        scopeId: id,
        name: "Home shell",
        cwd: null,
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await handleApiRequest(
      electronRequest("/api/sandboxes/active", { method: "PUT", body: JSON.stringify({ scopeId: id }) }),
    );

    const del = await handleApiRequest(electronRequest(`/api/sandboxes/${id}`, { method: "DELETE" }));
    expect(del?.status).toBe(204);

    const remaining = getDb().select().from(projects).all();
    expect(remaining.map((p) => p.id)).toEqual(["p-local"]); // p-client cascaded away
    expect(getDb().select().from(tasks).where(eq(tasks.id, "t-scoped")).get()).toBeUndefined();
    expect(
      getDb().select().from(userTerminals).where(eq(userTerminals.id, "ut-scoped")).get(),
    ).toBeUndefined();
    expect(
      getDb().select().from(homeTerminals).where(eq(homeTerminals.id, "ht-scoped")).get(),
    ).toBeUndefined();
    expect((await body(await handleApiRequest(electronRequest("/api/sandboxes")))).activeScopeId).toBe("local");
  });

  it("ignores an active scope pointing at a missing sandbox (self-heals to Local)", async () => {
    await handleApiRequest(
      electronRequest("/api/sandboxes/active", { method: "PUT", body: JSON.stringify({ scopeId: "sb-gone" }) }),
    );
    // setActiveScope rejects unknown ids → resolves to local
    expect((await body(await handleApiRequest(electronRequest("/api/sandboxes")))).activeScopeId).toBe("local");
  });
});
