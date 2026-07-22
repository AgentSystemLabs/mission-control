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
 * managed-create route — tests seed the row the same way the CLI would.
 * (Manually connected sandboxes register via POST /api/sandboxes/connect,
 * covered below.)
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

  it("registers a manually connected sandbox and enables the scope switcher", async () => {
    const res = await handleApiRequest(
      electronRequest("/api/sandboxes/connect", {
        method: "POST",
        body: JSON.stringify({
          name: "Home server",
          agentUrl: "wss://agent.example.com:443/",
          apiKey: "manual-key-123",
        }),
      }),
    );
    expect(res?.status).toBe(200);
    const { sandbox } = await body(res);
    expect(sandbox).toMatchObject({
      name: "Home server",
      kind: "remote-vm",
      remoteAgentUrl: "wss://agent.example.com/",
      remoteProvider: null,
      remoteStatus: null,
      hasPairingToken: true,
      hasApiKey: true,
    });
    expect(sandbox.pairingToken).toBeUndefined();

    const list = await body(await handleApiRequest(electronRequest("/api/sandboxes")));
    expect(list.enabled).toBe(true);
    expect(list.sandboxes.map((s: any) => s.id)).toContain(sandbox.id);

    const revealed = await body(
      await handleApiRequest(electronRequest(`/api/sandboxes/${sandbox.id}/api-key`)),
    );
    expect(revealed).toEqual({ apiKey: "manual-key-123" });
  });

  it("accepts a plaintext agent URL only for loopback hosts", async () => {
    const loopback = await handleApiRequest(
      electronRequest("/api/sandboxes/connect", {
        method: "POST",
        body: JSON.stringify({
          name: "Local tunnel",
          agentUrl: "ws://localhost:9333/",
          apiKey: "k",
        }),
      }),
    );
    expect(loopback?.status).toBe(200);
    expect((await body(loopback)).sandbox.remoteAgentUrl).toBe("ws://localhost:9333/");

    const publicPlaintext = await handleApiRequest(
      electronRequest("/api/sandboxes/connect", {
        method: "POST",
        body: JSON.stringify({
          name: "Insecure",
          agentUrl: "ws://agent.example.com:9333/",
          apiKey: "k",
        }),
      }),
    );
    expect(publicPlaintext?.status).toBe(400);
    expect((await body(publicPlaintext)).error).toMatch(/wss/);
  });

  // A real (long-lived) self-signed cert — connect validates the CA is exactly
  // one self-signed certificate before persisting it as a TLS pin.
  const SELF_SIGNED_PEM = `-----BEGIN CERTIFICATE-----
MIIBlzCCAT2gAwIBAgIUd8RjeQHJeRz8C81DrPegq+m2+84wCgYIKoZIzj0EAwIw
IDEeMBwGA1UEAwwVbWlzc2lvbi1jb250cm9sLWFnZW50MCAXDTI2MDcyMjE1MjAw
NloYDzIxMjYwNjI4MTUyMDA2WjAgMR4wHAYDVQQDDBVtaXNzaW9uLWNvbnRyb2wt
YWdlbnQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATRlcKWhhVLns6e104EQA+A
fhHfGBN2G9zPKxBZdwiRt7Gz4AOV11y1SzlBYYcJzSHCunV09VCr87JiypkGLTUs
o1MwUTAdBgNVHQ4EFgQU9N/7kcy7t+2fBnfm8yE07G7p3uMwHwYDVR0jBBgwFoAU
9N/7kcy7t+2fBnfm8yE07G7p3uMwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQD
AgNIADBFAiEA8JINJO8wccPca0e6vs6iv3Jmax5Tc0RmcCNS0zs2Z0cCIDEcqzvM
pAj8zbdZs8sSaRUrjO6n4giKgtb9xDEbh5bi
-----END CERTIFICATE-----`;

  // A well-formed leaf certificate signed by a separate CA (issuer ≠ subject) —
  // must be rejected by the self-signed check specifically.
  const CA_SIGNED_LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIBbjCCAROgAwIBAgIURSUvOVrkL/eELO5NgPM4izY8OsYwCgYIKoZIzj0EAwIw
EjEQMA4GA1UEAwwHdGVzdC1jYTAgFw0yNjA3MjIxNTI0MDlaGA8yMTI2MDYyODE1
MjQwOVowFTETMBEGA1UEAwwKYWdlbnQtbGVhZjBZMBMGByqGSM49AgEGCCqGSM49
AwEHA0IABLzDdN9b+zJf88AsBESMujq6sQ4pMkjU0ZGRT1qyJGq+FZe/4ocqId81
zOewz4wBFxONNX1mx5cL+EPTmd0bHJWjQjBAMB0GA1UdDgQWBBRlRzcsnw6QonVs
XzkYGGm/O41HUDAfBgNVHSMEGDAWgBRXKtiIHS1XyTTlA4oa6CP3//bW/DAKBggq
hkjOPQQDAgNJADBGAiEAgT+MjNC067+87hBZj/E3CUb/v7/24vsN+iUjsJyWN4QC
IQDKgylx1t9VnHbg07id7TJtpRnwoMskXtbR9ffY6+5lqA==
-----END CERTIFICATE-----`;

  it("rejects a connect body whose CA is not a single self-signed certificate", async () => {
    const post = (agentCa: string) =>
      handleApiRequest(
        electronRequest("/api/sandboxes/connect", {
          method: "POST",
          body: JSON.stringify({
            name: "Bad CA",
            agentUrl: "wss://agent.example.com/",
            apiKey: "k",
            agentCa,
          }),
        }),
      );

    expect((await post("not a certificate"))?.status).toBe(400);
    expect((await post("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"))?.status).toBe(400);
    expect((await post(`${SELF_SIGNED_PEM}\n${SELF_SIGNED_PEM}`))?.status).toBe(400);
    const withKey = await post(`${SELF_SIGNED_PEM}\n-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----`);
    expect(withKey?.status).toBe(400);
    expect((await body(withKey)).error).toMatch(/private key/i);
    // The verify branch itself: a parseable single cert that is CA-signed.
    const caSigned = await post(CA_SIGNED_LEAF_PEM);
    expect(caSigned?.status).toBe(400);
    expect((await body(caSigned)).error).toMatch(/self-signed/);
  });

  it("trims the sandbox name and rejects whitespace-only names", async () => {
    const whitespace = await handleApiRequest(
      electronRequest("/api/sandboxes/connect", {
        method: "POST",
        body: JSON.stringify({ name: "   ", agentUrl: "wss://agent.example.com/", apiKey: "k" }),
      }),
    );
    expect(whitespace?.status).toBe(400);

    const padded = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes/connect", {
          method: "POST",
          body: JSON.stringify({
            name: "  Home server  ",
            agentUrl: "wss://agent.example.com/",
            apiKey: "k",
          }),
        }),
      ),
    );
    expect(padded.sandbox.name).toBe("Home server");
  });

  it("persists the CA certificate into remote_config for TLS pinning", async () => {
    const res = await handleApiRequest(
      electronRequest("/api/sandboxes/connect", {
        method: "POST",
        body: JSON.stringify({
          name: "Pinned",
          agentUrl: "wss://agent.example.com/",
          apiKey: "k",
          agentCa: SELF_SIGNED_PEM,
        }),
      }),
    );
    expect(res?.status).toBe(200);
    const { sandbox } = await body(res);
    const row = getDb().select().from(sandboxes).where(eq(sandboxes.id, sandbox.id)).get();
    expect(JSON.parse(row!.remoteConfig!)).toMatchObject({
      agentUrl: "wss://agent.example.com/",
      agentCa: SELF_SIGNED_PEM,
    });
    expect(JSON.parse(row!.remoteConfig!).provider).toBeUndefined();
  });

  it("re-connecting the same agent URL updates the existing row instead of duplicating", async () => {
    const first = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes/connect", {
          method: "POST",
          body: JSON.stringify({
            name: "Home server",
            agentUrl: "wss://agent.example.com/",
            apiKey: "old-key",
            agentCa: SELF_SIGNED_PEM,
          }),
        }),
      ),
    );
    const firstConfig = JSON.parse(
      getDb().select().from(sandboxes).where(eq(sandboxes.id, first.sandbox.id)).get()!
        .remoteConfig!,
    );

    const second = await body(
      await handleApiRequest(
        electronRequest("/api/sandboxes/connect", {
          method: "POST",
          body: JSON.stringify({
            name: "Home server (renamed)",
            agentUrl: "https://agent.example.com/", // normalizes to the same wss URL
            apiKey: "rotated-key",
          }),
        }),
      ),
    );
    expect(second.sandbox.id).toBe(first.sandbox.id);
    expect(second.sandbox.name).toBe("Home server (renamed)");

    const rows = getDb().select().from(sandboxes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pairingToken).toBe("rotated-key");

    // The rebuilt config keeps the original createdAt; each submission fully
    // states its TLS intent, so omitting agentCa on reconnect drops the pin.
    const secondConfig = JSON.parse(rows[0]!.remoteConfig!);
    expect(secondConfig.createdAt).toBe(firstConfig.createdAt);
    expect(secondConfig.agentCa).toBeUndefined();
  });

  it("ignores an active scope pointing at a missing sandbox (self-heals to Local)", async () => {
    await handleApiRequest(
      electronRequest("/api/sandboxes/active", { method: "PUT", body: JSON.stringify({ scopeId: "sb-gone" }) }),
    );
    // setActiveScope rejects unknown ids → resolves to local
    expect((await body(await handleApiRequest(electronRequest("/api/sandboxes")))).activeScopeId).toBe("local");
  });
});
