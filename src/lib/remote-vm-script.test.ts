import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";

// @ts-expect-error The deploy CLI is a Node .mjs script; tests exercise its exported helpers.
const remoteVm = await import("../../scripts/remote-vm.mjs");

const {
  buildAwsRunInstancesArgs,
  buildAwsInstanceLifecycleArgs,
  buildDoctlDropletActionArgs,
  buildDoctlDropletCreateArgs,
  buildSshArgs,
  createRemoteConfig,
  decodeSetupScript,
  deepFindRailwayHost,
  ensureRemoteVmSchema,
  extractJsonFromCliOutput,
  insertRemoteVmSandbox,
  isRailwayDeploymentFailed,
  isRailwayDeploymentReady,
  isRailwayNoDeploymentsMessage,
  latestRailwayDeploymentStatus,
  normalizeGitAuthMode,
  parseFlagArgs,
  railwaySafeServiceName,
  renderIdleWatchdog,
  renderUserData,
  renderUserSetup,
  selectRailwayWorkspaceId,
  statusForAwsInstanceState,
  updateRemoteVmStatus,
} = remoteVm;

describe("remote-vm CLI helpers", () => {
  it("parses flags and positionals", () => {
    const parsed = parseFlagArgs([
      "sb-123",
      "--local-port",
      "19334",
      "--activate",
      "--name=Client VM",
      "--sandbox-id",
      "sb-deploy",
    ]);
    expect(parsed.positionals).toEqual(["sb-123"]);
    expect(parsed.flags).toMatchObject({
      "local-port": "19334",
      activate: true,
      name: "Client VM",
      "sandbox-id": "sb-deploy",
    });
  });

  it("renders host-level user data matching the agent Docker install recipe", () => {
    const script = renderUserData({ apiKey: "abc123", agentPort: 9333 });
    expect(script).toContain("apt-get install -y --no-install-recommends");
    expect(script).toContain("https://deb.nodesource.com/setup_24.x");
    expect(script).toContain("corepack prepare pnpm@11.1.2 --activate");
    expect(script).toContain("@openai/codex@latest");
    expect(script).toContain("@anthropic-ai/claude-code@latest");
    expect(script).toContain("opencode-ai@latest");
    expect(script).toContain("@agentsystemlabs/mission-control-agent@latest");
    expect(script).toContain("https://cursor.com/install");
    expect(script).toContain("MC_AGENT_BIND_HOST=0.0.0.0");
    expect(script).toContain("User=workspace");
    expect(script).not.toContain("docker compose");
  });

  it("resolves the agent bin via PATH instead of a hardcoded /usr/local/bin path", () => {
    const script = renderUserData({ apiKey: "abc123" });
    // The NodeSource deb installs the global bin under /usr/bin, so the old
    // hardcoded ExecStart silently failed with 203/EXEC and the deploy hung.
    expect(script).not.toContain("/usr/local/bin/mission-control-agent");
    expect(script).toContain("ExecStart=/usr/bin/env mission-control-agent");
    // And it fails the bootstrap loudly if the bin never installed.
    expect(script).toContain("command -v mission-control-agent");
  });

  it("does not emit the TLS sidecar when tls is off (DigitalOcean path)", () => {
    const script = renderUserData({ apiKey: "abc123" });
    expect(script).not.toContain("mc-tls-proxy.mjs");
    expect(script).not.toContain("mission-control-tls.service");
    expect(script).toContain("MC_AGENT_BIND_HOST=0.0.0.0");
  });

  it("emits a self-signed TLS sidecar and binds the agent to loopback when tls is on", () => {
    const script = renderUserData({ apiKey: "abc123", tls: true });
    // Agent is loopback-only; the sidecar is the only public listener.
    expect(script).toContain("MC_AGENT_BIND_HOST=127.0.0.1");
    expect(script).toContain("openssl req -x509");
    expect(script).toContain("/usr/local/lib/mc-tls-proxy.mjs");
    expect(script).toContain("mission-control-tls.service");
    expect(script).toContain("systemctl enable --now mission-control-tls");
    // Readiness verifies the HTTPS path on 443 before declaring the box ready.
    expect(script).toContain("https://127.0.0.1:443/health");
  });

  it("builds a wss:// pinned remote config for TLS cloud VMs", () => {
    const remoteConfig = createRemoteConfig({
      provider: "aws",
      providerId: "i-123",
      providerName: "AWS EC2",
      name: "Client VM",
      region: "us-east-1",
      size: "t3.medium",
      image: "ubuntu",
      publicIp: "203.0.113.10",
      sshUser: null,
      identityFile: null,
      localPort: null,
      accessMode: "direct",
      tls: true,
      agentCa: "-----BEGIN CERTIFICATE-----\nPEM\n-----END CERTIFICATE-----\n",
      agentCertSha256: "AA:BB",
      status: "provisioning",
      cloud: { securityGroupId: "sg-123" },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(remoteConfig).toMatchObject({
      agentUrl: "wss://203.0.113.10:443/",
      tls: true,
      allowPlaintextPublic: false,
      agentPort: 443,
      agentBindHost: "127.0.0.1",
      agentCa: "-----BEGIN CERTIFICATE-----\nPEM\n-----END CERTIFICATE-----\n",
      agentCertSha256: "AA:BB",
    });
  });

  it("builds AWS run-instances args with user-data and no required key pair", () => {
    const args = buildAwsRunInstancesArgs(
      {
        name: "Client VM",
        size: "t3.medium",
        subnetId: "subnet-123",
      },
      {
        imageId: "resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id",
        securityGroupId: "sg-123",
        userDataFile: "/tmp/user-data.sh",
      },
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "run-instances",
        "--instance-type",
        "t3.medium",
        "--security-group-ids",
        "sg-123",
        "--user-data",
        "file:///tmp/user-data.sh",
        "--subnet-id",
        "subnet-123",
        "--associate-public-ip-address",
      ]),
    );
    expect(args).not.toContain("--key-name");
  });

  it("builds provider lifecycle commands for pause and resume", () => {
    expect(buildAwsInstanceLifecycleArgs("stop-instances", "i-123")).toEqual([
      "ec2",
      "stop-instances",
      "--instance-ids",
      "i-123",
    ]);
    expect(buildAwsInstanceLifecycleArgs("start-instances", "i-123")).toEqual([
      "ec2",
      "start-instances",
      "--instance-ids",
      "i-123",
    ]);
    expect(buildDoctlDropletActionArgs("power-on", "12345")).toEqual([
      "compute",
      "droplet-action",
      "power-on",
      "12345",
      "--wait",
    ]);
  });

  it("builds DigitalOcean droplet create args with cloud-init user-data and no required SSH key", () => {
    const args = buildDoctlDropletCreateArgs(
      {
        name: "client-vm",
        size: "s-2vcpu-4gb",
        image: "ubuntu-24-04-x64",
        region: "nyc1",
        enableMonitoring: true,
      },
      { userDataFile: "/tmp/user-data.sh" },
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "droplet",
        "create",
        "client-vm",
        "--size",
        "s-2vcpu-4gb",
        "--image",
        "ubuntu-24-04-x64",
        "--region",
        "nyc1",
        "--user-data-file",
        "/tmp/user-data.sh",
        "--wait",
        "--enable-monitoring",
      ]),
    );
    expect(args).not.toContain("--ssh-keys");
  });

  it("builds SSH tunnel args without exposing the agent publicly", () => {
    const args = buildSshArgs({
      host: "203.0.113.10",
      user: "ubuntu",
      identityFile: "~/.ssh/mc.pem",
      localPort: 19333,
    });
    expect(args).toEqual(
      expect.arrayContaining([
        "-L",
        "127.0.0.1:19333:127.0.0.1:9333",
        "ubuntu@203.0.113.10",
      ]),
    );
    expect(args).toContain("ExitOnForwardFailure=yes");
  });

  it("stores cloud VM state in the existing sandboxes/app_settings tables", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-vm-test-"));
    const db = new Database(path.join(dir, "missioncontrol.db"));
    try {
      ensureRemoteVmSchema(db);
      const remoteConfig = createRemoteConfig({
        provider: "aws",
        providerId: "i-123",
        providerName: "AWS EC2",
        name: "Client VM",
        region: "us-east-1",
        size: "t3.medium",
        image: "ubuntu",
        publicIp: "203.0.113.10",
        sshUser: null,
        identityFile: null,
        localPort: null,
        accessMode: "direct",
        status: "provisioning",
        cloud: { securityGroupId: "sg-123" },
        createdAt: 1,
        updatedAt: 1,
      });
      insertRemoteVmSandbox(db, {
        id: "sb-test",
        name: "Client VM",
        apiKey: "secret-key",
        remoteConfig,
        activate: true,
      });

      const row = db.prepare("SELECT * FROM sandboxes WHERE id = ?").get("sb-test") as {
        kind: string;
        pairing_token: string;
        remote_config: string;
      };
      expect(row.kind).toBe("remote-vm");
      expect(row.pairing_token).toBe("secret-key");
      expect(JSON.parse(row.remote_config)).toMatchObject({
        agentUrl: "ws://203.0.113.10:9333/",
        allowPlaintextPublic: true,
        provider: "aws",
        providerId: "i-123",
        installMode: "host",
        runtimeUser: "workspace",
      });
      expect(
        (db.prepare("SELECT value FROM app_settings WHERE key = ?").get("multiSandbox.enabled") as { value: string }).value,
      ).toBe("true");
      expect(
        (db.prepare("SELECT value FROM app_settings WHERE key = ?").get("multiSandbox.activeScope") as { value: string }).value,
      ).toBe("sb-test");

      updateRemoteVmStatus(db, "sb-test", "ready", null, { publicIp: "203.0.113.11" });
      expect(
        JSON.parse(
          (
            db.prepare("SELECT remote_config FROM sandboxes WHERE id = ?").get("sb-test") as {
              remote_config: string;
            }
          ).remote_config,
        ),
      ).toMatchObject({
        status: "ready",
        publicIp: "203.0.113.11",
      });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a wss:// remote config for Railway over a public-CA TLS edge", () => {
    // Railway terminates TLS with a real cert, so the config rides wss:// with
    // standard trust — no self-signed pinning and NOT flagged plaintext-public.
    const remoteConfig = createRemoteConfig({
      provider: "railway",
      providerId: "client-vm-1a2b",
      providerName: "Railway",
      name: "Client VM",
      region: null,
      size: null,
      image: "AgentSystemLabs/mission-control-agent",
      publicIp: "client-vm-1a2b.up.railway.app",
      agentUrl: "wss://client-vm-1a2b.up.railway.app/",
      agentPort: 443,
      sshUser: null,
      identityFile: null,
      localPort: null,
      accessMode: "direct",
      tls: false,
      allowPlaintextPublic: false,
      status: "provisioning",
      cloud: { projectName: "mission-control", serviceName: "client-vm-1a2b" },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(remoteConfig).toMatchObject({
      agentUrl: "wss://client-vm-1a2b.up.railway.app/",
      tls: false,
      // The override must win over the default (!tls && direct === true).
      allowPlaintextPublic: false,
      provider: "railway",
      agentCa: null,
      agentCertSha256: null,
    });
  });

  it("extracts the railway host from assorted CLI JSON shapes", () => {
    expect(deepFindRailwayHost({ domain: "https://foo-bar.up.railway.app" })).toBe(
      "foo-bar.up.railway.app",
    );
    expect(deepFindRailwayHost([{ serviceDomain: { domain: "baz.up.railway.app/" } }])).toBe(
      "baz.up.railway.app",
    );
    expect(deepFindRailwayHost({ nested: { deep: ["qux.railway.app"] } })).toBe("qux.railway.app");
    expect(deepFindRailwayHost({ url: "https://example.com" })).toBeNull();
    expect(deepFindRailwayHost(null)).toBeNull();
  });

  it("slugifies a sandbox name into a unique railway service name", () => {
    const a = railwaySafeServiceName("Client X!!");
    expect(a).toMatch(/^client-x-[0-9a-f]{4}$/);
    // Empty/symbol-only names still produce a valid service name.
    expect(railwaySafeServiceName("   ")).toMatch(/^agent-[0-9a-f]{4}$/);
    // Two calls with the same name don't collide (random suffix).
    expect(railwaySafeServiceName("dup")).not.toBe(railwaySafeServiceName("dup"));
  });

  it("extracts JSON from Railway CLI stdout that prefixes status lines", () => {
    const stdout = `> Select a workspace Web Dev Cody's Projects
> Project Name mission-control
{"id":"b9585a02-4988-4e1a-be55-6a676f74ee40","name":"mission-control"}`;
    expect(extractJsonFromCliOutput(stdout, "railway init")).toEqual({
      id: "b9585a02-4988-4e1a-be55-6a676f74ee40",
      name: "mission-control",
    });
  });

  it("selects a Railway workspace id from whoami output", () => {
    const workspaces = [{ id: "ws-1", name: "Personal" }];
    expect(selectRailwayWorkspaceId(workspaces, "")).toBe("ws-1");
    expect(selectRailwayWorkspaceId(workspaces, "Personal")).toBe("ws-1");
    expect(selectRailwayWorkspaceId(workspaces, "ws-1")).toBe("ws-1");
    expect(() =>
      selectRailwayWorkspaceId(
        [
          { id: "ws-1", name: "Personal" },
          { id: "ws-2", name: "Team" },
        ],
        "",
      ),
    ).toThrow(/RAILWAY_WORKSPACE/);
  });

  it("recognizes Railway deployment readiness from CLI JSON", () => {
    expect(isRailwayDeploymentReady("SUCCESS")).toBe(true);
    expect(isRailwayDeploymentReady("active")).toBe(true);
    expect(isRailwayDeploymentReady("COMPLETED")).toBe(true);
    expect(isRailwayDeploymentReady("BUILDING")).toBe(false);
    expect(isRailwayDeploymentFailed("CRASHED")).toBe(true);
    expect(
      latestRailwayDeploymentStatus([{ status: "DEPLOYING" }, { status: "SUCCESS" }]),
    ).toBe("DEPLOYING");
  });

  it("treats missing Railway deployments or services as cleanup-safe", () => {
    expect(isRailwayNoDeploymentsMessage("No deployments found. Deploy first with `railway up`.")).toBe(
      true,
    );
    expect(isRailwayNoDeploymentsMessage("Service 'railway-8d02' not found")).toBe(true);
    expect(isRailwayNoDeploymentsMessage("Unauthorized")).toBe(false);
  });

  it("allows destroy without cloud teardown for bring-your-own remote VMs", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/remote-vm.mjs"), "utf8");
    expect(script).toContain("bring-your-own remote VM — no cloud resources to terminate");
  });

  it("uses mount-path-only volume add for current Railway CLI", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/remote-vm.mjs"), "utf8");
    expect(script).toContain("MC_RAILWAY_CONFIG_FILE");
    expect(script).toContain("deploy/railway/railway.json");
    expect(script).toContain("export async function ensureRailwayConfigFile");
    expect(script).toContain('"configFile"');
    expect(script).toContain('["volume", "add", "--mount-path", MC_RAILWAY_VOLUME_MOUNT]');
    expect(script).not.toMatch(/volume", "add", "--service"/);
    const configIdx = script.indexOf("await ensureRailwayConfigFile(work, { projectId, serviceName })");
    const volumeIdx = script.indexOf('["volume", "add", "--mount-path", MC_RAILWAY_VOLUME_MOUNT]');
    expect(configIdx).toBeGreaterThan(-1);
    expect(volumeIdx).toBeGreaterThan(configIdx);
    const persistIdx = script.indexOf("Deploying agent to Railway");
    const domainIdx = script.indexOf("await ensureRailwayDomain(work, { projectId, workspaceId, serviceName })");
    const apiKeyIdx = script.indexOf("ensureRailwayApiKey(work, serviceName, apiKey)");
    const bootstrapIdx = script.indexOf("    bootstrapRailwayUpload(sourceDir, serviceName);");
    const finalDeployIdx = script.indexOf("final Railway deploy (waiting for this deployment to succeed)");
    expect(volumeIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(volumeIdx);
    expect(domainIdx).toBeGreaterThan(persistIdx);
    expect(apiKeyIdx).toBeGreaterThan(domainIdx);
    expect(bootstrapIdx).toBeGreaterThan(apiKeyIdx);
    expect(finalDeployIdx).toBeGreaterThan(bootstrapIdx);
    expect(script).toContain("export async function ensureRailwayDomain");
    expect(script).toContain('["variable", "set", `MC_AGENT_API_KEY=${apiKey}`');
    expect(script).not.toContain("generateRailwayDomain");
    expect(script).not.toContain('["domain", "--service", serviceName, "--json"], { cwd, allowFail: true }');
    expect(script).toContain("bootstrap upload to Railway");
    expect(script).toContain('["up", "--service", serviceName, "--ci"]');
    expect(script).not.toContain('"--detach"');
    expect(script).not.toContain('["redeploy", "--service", serviceName, "--yes"]');
    expect(script).not.toContain('"--repo"');
    expect(script).toContain("waitForRailwayDeployment(work, serviceName");
    expect(script).toContain("cloneAgentRepo(sourceDir)");
    expect(script).toContain("cleanupRailwaySandbox(cfg)");
    expect(script).toContain("serviceDelete");
  });

  it("always wires the activity heartbeat env + runtime dir for the idle watchdog", () => {
    const script = renderUserData({ apiKey: "abc123", tls: true });
    expect(script).toContain("MC_AGENT_ACTIVITY_FILE=/run/mission-control-agent/activity");
    expect(script).toContain("RuntimeDirectory=mission-control-agent");
  });

  it("installs the idle auto-stop watchdog only when an idle timeout is set", () => {
    const withIdle = renderUserData({ apiKey: "abc123", tls: true, idleTimeoutMinutes: 30 });
    expect(withIdle).toContain("mission-control-idle.timer");
    expect(withIdle).toContain("/usr/local/lib/mc-idle-check.sh");
    expect(withIdle).toContain("systemctl enable --now mission-control-idle.timer");
    // 30 minutes → 1800 seconds baked into the unit + script default.
    expect(withIdle).toContain("MC_IDLE_SECONDS=1800");
    expect(withIdle).toContain("/sbin/shutdown -h now");

    const noIdle = renderUserData({ apiKey: "abc123", tls: true, idleTimeoutMinutes: 0 });
    expect(noIdle).not.toContain("mission-control-idle.timer");
    expect(noIdle).not.toContain("mc-idle-check.sh");
  });

  it("renders an idle watchdog that no-ops until the agent reports activity", () => {
    const frag = renderIdleWatchdog({ idleSeconds: 600, activityFile: "/run/x/activity" });
    // Guard: don't stop a box that never finished provisioning (no activity file).
    expect(frag).toContain('[ -f "$FILE" ] || exit 0');
    expect(frag).toContain("MC_IDLE_SECONDS=600");
    expect(frag).toContain("OnUnitActiveSec=1min");
  });

  it("embeds a user setup script base64-encoded so its content can't break bootstrap", () => {
    const setupScript = "#!/usr/bin/env bash\necho 'hi' # with 'quotes' and a MC_SETUP_B64 word\n";
    const script = renderUserData({ apiKey: "abc123", tls: true, setupScript });
    const b64 = Buffer.from(setupScript, "utf8").toString("base64");
    expect(script).toContain(b64);
    expect(script).toContain("base64 -d /opt/mission-control-agent/setup.b64");
    // Runs isolated: a non-zero exit is logged, never aborts provisioning.
    expect(script).toContain("/var/log/mission-control-setup.log");
    // The literal script text is NOT spliced in raw (only the base64 form).
    expect(script).not.toContain("echo 'hi' # with 'quotes'");
  });

  it("omits the setup-script block when no script is provided", () => {
    const script = renderUserData({ apiKey: "abc123", tls: true });
    expect(script).not.toContain("setup.b64");
    expect(script).not.toContain("user setup script");
  });

  it("renderUserSetup round-trips arbitrary script content through base64", () => {
    const content = "line1\nline2 'with quotes' && echo $HOME\n";
    const frag = renderUserSetup({ setupScript: content });
    const b64 = Buffer.from(content, "utf8").toString("base64");
    expect(frag).toContain(b64);
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(content);
  });

  it("normalizes git auth mode to the allowed values", () => {
    expect(normalizeGitAuthMode("copy-host")).toBe("copy-host");
    expect(normalizeGitAuthMode("generate")).toBe("generate");
    expect(normalizeGitAuthMode("none")).toBe("none");
    expect(normalizeGitAuthMode("garbage")).toBe("none");
    expect(normalizeGitAuthMode("")).toBe("none");
    expect(normalizeGitAuthMode(undefined)).toBe("none");
  });

  it("decodes a base64 setup script, tolerating empty/invalid input", () => {
    const b64 = Buffer.from("echo hi\n", "utf8").toString("base64");
    expect(decodeSetupScript(b64)).toBe("echo hi\n");
    expect(decodeSetupScript("")).toBe("");
    expect(decodeSetupScript(undefined)).toBe("");
  });

  it("maps AWS instance states to a saved lifecycle status", () => {
    expect(statusForAwsInstanceState("stopped")).toBe("paused");
    expect(statusForAwsInstanceState("stopping")).toBe("paused");
    expect(statusForAwsInstanceState("shutting-down")).toBe("paused");
    // Running/pending are handled by start/resume — reconcile leaves them alone.
    expect(statusForAwsInstanceState("running")).toBeNull();
    expect(statusForAwsInstanceState("pending")).toBeNull();
    expect(statusForAwsInstanceState(null)).toBeNull();
  });

  it("persists the requested git auth mode for a deployed sandbox", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-vm-auth-"));
    const db = new Database(path.join(dir, "missioncontrol.db"));
    try {
      ensureRemoteVmSchema(db);
      const remoteConfig = createRemoteConfig({
        provider: "aws",
        providerId: "i-abc",
        providerName: "AWS EC2",
        name: "Auth VM",
        region: "us-east-1",
        size: "t3.medium",
        image: "ubuntu",
        publicIp: "203.0.113.5",
        sshUser: null,
        identityFile: null,
        localPort: null,
        accessMode: "direct",
        tls: true,
        status: "provisioning",
        cloud: {},
        createdAt: 1,
        updatedAt: 1,
      });
      insertRemoteVmSandbox(db, {
        id: "sb-auth",
        name: "Auth VM",
        apiKey: "k",
        remoteConfig,
        gitAuthMode: "copy-host",
      });
      const row = db.prepare("SELECT git_auth_mode FROM sandboxes WHERE id = ?").get("sb-auth") as {
        git_auth_mode: string;
      };
      expect(row.git_auth_mode).toBe("copy-host");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists copy_agent_creds when requested, defaulting to 0", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-remote-vm-creds-"));
    const db = new Database(path.join(dir, "missioncontrol.db"));
    try {
      ensureRemoteVmSchema(db);
      const remoteConfig = createRemoteConfig({
        provider: "aws",
        providerId: "i-abc",
        providerName: "AWS EC2",
        name: "Creds VM",
        region: "us-east-1",
        size: "t3.medium",
        image: "ubuntu",
        publicIp: "203.0.113.6",
        sshUser: null,
        identityFile: null,
        localPort: null,
        accessMode: "direct",
        tls: true,
        status: "provisioning",
        cloud: {},
        createdAt: 1,
        updatedAt: 1,
      });
      insertRemoteVmSandbox(db, { id: "sb-creds", name: "Creds VM", apiKey: "k", remoteConfig, copyAgentCreds: true });
      insertRemoteVmSandbox(db, { id: "sb-nocreds", name: "No Creds VM", apiKey: "k", remoteConfig });
      const on = db.prepare("SELECT copy_agent_creds AS v FROM sandboxes WHERE id = ?").get("sb-creds") as { v: number };
      const off = db.prepare("SELECT copy_agent_creds AS v FROM sandboxes WHERE id = ?").get("sb-nocreds") as { v: number };
      expect(on.v).toBe(1);
      expect(off.v).toBe(0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
