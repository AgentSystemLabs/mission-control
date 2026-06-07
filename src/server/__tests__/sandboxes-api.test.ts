import { beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sandboxes-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;
const keypair = generateKeyPairSync("ed25519");
process.env.MC_LICENSE_PUBLIC_KEY = keypair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const { handleApiRequest } = await import("../api-router");
const { getDb } = await import("~/db/client");
const { sandboxes, projects, appSettings, tasks, userTerminals, homeTerminals } = await import("~/db/schema");
const { getOrCreateApiToken } = await import("../services/settings");
const { insertProject } = await import("../repositories/projects.repo");
const { setLicenseKey, clearLicense } = await import("../services/license-storage");
const { eq } = await import("drizzle-orm");
const { HTTP_PAYMENT_REQUIRED } = await import("~/shared/http-status");

async function body(res: Response | null | undefined) {
  return (await res!.json()) as Record<string, any>;
}

function electronRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${getOrCreateApiToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${input}`, { ...init, headers });
}

function remoteSandboxBody(name: string) {
  return {
    name,
    kind: "remote-vm",
    remoteAgentUrl: "https://agent.example.com",
    apiKey: "0123456789abcdef0123456789abcdef",
  };
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
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: now,
    updatedAt: now,
  });
}

function signedLicense(overrides: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      licenseId: "lic_test",
      customerId: "cus_test",
      product: "mission-control-pro",
      tier: "pro",
      expiresAt: null,
      maxMachines: 3,
      issuedAt: "2026-05-07T17:10:17.000Z",
      ...overrides,
    }),
    "utf8",
  );
  const signature = sign(null, payload, keypair.privateKey);
  return `MC-PRO-v1.${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

describe("sandboxes API", () => {
  beforeEach(() => {
    getDb().delete(homeTerminals).run();
    getDb().delete(userTerminals).run();
    getDb().delete(tasks).run();
    getDb().delete(projects).run();
    getDb().delete(sandboxes).run();
    getDb().delete(appSettings).run();
    clearLicense();
  });

  it("creates a sandbox, enables the feature, and lists it with the active scope", async () => {
    const created = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("Flexion")) }),
      ),
    );
    expect(created.sandbox.name).toBe("Flexion");
    const id = created.sandbox.id as string;

    const list = await body(await handleApiRequest(electronRequest("/api/sandboxes")));
    expect(list.enabled).toBe(true); // creating one turns the feature on
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
    const created = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("Flexion")) }),
      ),
    );
    const id = created.sandbox.id as string;

    getDb()
      .update(sandboxes)
      .set({
        pairingToken: "secret-token",
        portMap: JSON.stringify({ 5173: 15173 }),
      })
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

  it("creates remote VM sandboxes with URL/API-key redaction", async () => {
    const created = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes", {
          method: "POST",
          body: JSON.stringify({
            name: "Railway",
            kind: "remote-vm",
            remoteAgentUrl: "https://agent.example.com",
            apiKey: "0123456789abcdef0123456789abcdef",
          }),
        }),
      ),
    );

    expect(created.sandbox).toMatchObject({
      name: "Railway",
      kind: "remote-vm",
      remoteAgentUrl: "wss://agent.example.com/",
      hasApiKey: true,
      hasPairingToken: true,
    });
    expect(created.sandbox.apiKey).toBeUndefined();
    expect(created.sandbox.pairingToken).toBeUndefined();

    const id = created.sandbox.id as string;
    const stored = getDb().select().from(sandboxes).where(eq(sandboxes.id, id)).get();
    expect(stored?.pairingToken).toBe("0123456789abcdef0123456789abcdef");
    expect(stored?.remoteConfig).toContain("wss://agent.example.com/");

    const revealed = await body(
      await handleApiRequest(electronRequest(`/api/sandboxes/${id}/api-key`)),
    );
    expect(revealed).toEqual({ apiKey: "0123456789abcdef0123456789abcdef" });
  });

  it("requires URL and API key when creating a remote VM sandbox", async () => {
    const create = await handleApiRequest(
      electronRequest("/api/sandboxes", {
        method: "POST",
        body: JSON.stringify({
          name: "Remote",
          kind: "remote-vm",
          remoteAgentUrl: "https://agent.example.com",
        }),
      }),
    );

    expect(create?.status).toBe(400);
  });

  it("deleting a sandbox cascade-deletes its projects, scoped rows, and resets the active scope to Local", async () => {
    const created = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("Client")) }),
      ),
    );
    const id = created.sandbox.id as string;
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

  it("returns 402 when a lite user tries to create a second sandbox", async () => {
    await handleApiRequest(
      electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("First")) }),
    );

    const second = await handleApiRequest(
      electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("Second")) }),
    );
    expect(second?.status).toBe(HTTP_PAYMENT_REQUIRED);
    const payload = await body(second);
    expect(payload.code).toBe("free_tier_sandbox_cap");
  });

  it("allows multiple sandboxes when an active license is on file", async () => {
    setLicenseKey(signedLicense());

    await handleApiRequest(
      electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("First")) }),
    );
    const second = await handleApiRequest(
      electronRequest("/api/sandboxes", { method: "POST", body: JSON.stringify(remoteSandboxBody("Second")) }),
    );
    expect(second?.status).toBe(201);

    const list = await body(await handleApiRequest(electronRequest("/api/sandboxes")));
    expect(list.sandboxes).toHaveLength(2);
  });
});
