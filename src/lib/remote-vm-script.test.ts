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
  buildSshArgs,
  createRemoteConfig,
  decodeSetupScript,
  ensureRemoteVmSchema,
  insertRemoteVmSandbox,
  isAwsInstanceMissingError,
  isGoneAwsInstanceState,
  normalizeGitAuthMode,
  parseFlagArgs,
  renderIdleWatchdog,
  renderUserData,
  renderInstallScript,
  renderBootUserData,
  renderUserSetup,
  shouldPersistAwsReconciledStatus,
  statusForAwsInstanceState,
  updateRemoteVmStatus,
  parseGoldenAmiManifest,
  archForInstanceSize,
  resolveGoldenAmi,
  fetchGoldenAmiManifest,
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

  it("does not emit the TLS sidecar when tls is off", () => {
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

  it("allows destroy without cloud teardown for remote VMs with no managed AWS instance", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/remote-vm.mjs"), "utf8");
    expect(script).toContain("no cloud resources to terminate");
    // Legacy rows tagged with a removed provider must NOT throw on destroy.
    expect(script).not.toContain('Unsupported remote VM provider');
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

  it("allows AWS stopped to complete a saved pausing lifecycle state", () => {
    expect(shouldPersistAwsReconciledStatus("pausing", "stopped", "paused")).toBe(true);
    expect(shouldPersistAwsReconciledStatus("pausing", "stopping", "paused")).toBe(false);
    expect(shouldPersistAwsReconciledStatus("resuming", "stopped", "paused")).toBe(false);
  });

  it("recognizes AWS 'instance gone' CLI errors so destroy/reconcile stay idempotent", () => {
    expect(
      isAwsInstanceMissingError(
        "An error occurred (InvalidInstanceID.NotFound) when calling the TerminateInstances operation: The instance ID 'i-0abc' does not exist",
      ),
    ).toBe(true);
    expect(isAwsInstanceMissingError("The instance ID 'i-0abc' does not exist")).toBe(true);
    expect(isAwsInstanceMissingError("instance i-0abc not found")).toBe(true);
    // Unrelated failures must NOT be swallowed as "already gone".
    expect(isAwsInstanceMissingError("UnauthorizedOperation: you are not authorized")).toBe(false);
    expect(isAwsInstanceMissingError("RequestLimitExceeded")).toBe(false);
    expect(isAwsInstanceMissingError("")).toBe(false);
    expect(isAwsInstanceMissingError(null)).toBe(false);
  });

  it("treats terminated/shutting-down/missing instance states as gone", () => {
    expect(isGoneAwsInstanceState("missing")).toBe(true);
    expect(isGoneAwsInstanceState("terminated")).toBe(true);
    expect(isGoneAwsInstanceState("shutting-down")).toBe(true);
    // A merely stopped or running instance is NOT gone — it's resumable/usable.
    expect(isGoneAwsInstanceState("stopped")).toBe(false);
    expect(isGoneAwsInstanceState("running")).toBe(false);
    expect(isGoneAwsInstanceState(null)).toBe(false);
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

describe("golden AMI provisioning", () => {
  describe("install/boot split", () => {
    it("renderInstallScript bakes the heavy installs and no secrets", () => {
      const script = renderInstallScript();
      expect(script).toContain("apt-get install -y --no-install-recommends");
      expect(script).toContain("https://deb.nodesource.com/setup_24.x");
      expect(script).toContain("npm install -g @openai/codex@latest");
      expect(script).toContain("https://cursor.com/install");
      // Secrets + per-instance config must NEVER be baked into the public image.
      expect(script).not.toContain("MC_AGENT_API_KEY");
      expect(script).not.toContain("openssl req -x509");
      expect(script).not.toContain("systemctl enable --now mission-control-agent");
    });

    it("renderBootUserData writes the per-instance secret/cert and no installs", () => {
      const script = renderBootUserData({ apiKey: "secret-123", tls: true });
      expect(script).toContain("MC_AGENT_API_KEY=secret-123");
      expect(script).toContain("openssl req -x509");
      expect(script).toContain("systemctl enable --now mission-control-agent");
      expect(script).toContain("MC_AGENT_BIND_HOST=127.0.0.1");
      // The heavy install steps are baked into the AMI, never re-run at boot.
      // (Match real install commands, not the systemd-unit comment that mentions npm.)
      expect(script).not.toContain("apt-get install -y --no-install-recommends");
      expect(script).not.toContain("https://deb.nodesource.com/setup_24.x");
      expect(script).not.toContain("npm install -g @openai/codex");
      expect(script).not.toContain("corepack prepare pnpm");
    });

    it("renderUserData composes install BEFORE boot for the fallback path", () => {
      const script = renderUserData({ apiKey: "abc123", tls: true });
      const installIdx = script.indexOf("apt-get install -y --no-install-recommends");
      const bootIdx = script.indexOf("MC_AGENT_API_KEY=abc123");
      expect(installIdx).toBeGreaterThanOrEqual(0);
      expect(bootIdx).toBeGreaterThan(installIdx);
      expect(script).toContain("openssl req -x509");
      expect(script).toContain("systemctl enable --now mission-control-agent");
    });
  });

  describe("archForInstanceSize", () => {
    it("maps intel/amd families to x86_64", () => {
      expect(archForInstanceSize("t3.medium")).toBe("x86_64");
      expect(archForInstanceSize("m7i.large")).toBe("x86_64");
      expect(archForInstanceSize("g4dn.xlarge")).toBe("x86_64");
      expect(archForInstanceSize("")).toBe("x86_64");
    });
    it("maps graviton families to arm64", () => {
      expect(archForInstanceSize("t4g.medium")).toBe("arm64");
      expect(archForInstanceSize("c7g.xlarge")).toBe("arm64");
      expect(archForInstanceSize("c7gn.large")).toBe("arm64");
      expect(archForInstanceSize("x2gd.large")).toBe("arm64");
      expect(archForInstanceSize("a1.medium")).toBe("arm64");
    });
  });

  describe("parseGoldenAmiManifest", () => {
    const valid = JSON.stringify({
      schemaVersion: 1,
      version: "2026.06.06-1",
      agentVersion: "0.40.0",
      arch: "x86_64",
      owner: "123456789012",
      builtAt: "2026-06-06T00:00:00Z",
      images: { "us-east-1": "ami-0abc123", "bad-region": "not-an-ami" },
    });
    it("normalizes a valid manifest and filters bad ami ids", () => {
      const m = parseGoldenAmiManifest(valid);
      expect(m).not.toBeNull();
      expect(m.owner).toBe("123456789012");
      expect(m.images).toEqual({ "us-east-1": "ami-0abc123" });
    });
    it("returns null for invalid json or missing images", () => {
      expect(parseGoldenAmiManifest("not json")).toBeNull();
      expect(parseGoldenAmiManifest(JSON.stringify({ version: "x" }))).toBeNull();
    });
    it("rejects a non-12-digit owner but keeps the images", () => {
      const m = parseGoldenAmiManifest(
        JSON.stringify({ owner: "123", images: { "us-east-1": "ami-0a" } }),
      );
      expect(m.owner).toBeNull();
      expect(m.images).toEqual({ "us-east-1": "ami-0a" });
    });
  });

  describe("resolveGoldenAmi", () => {
    const manifest = {
      arch: "x86_64",
      owner: "123456789012",
      version: "v1",
      images: { "us-east-1": "ami-0east", "us-west-2": "ami-0west" },
    };
    it("resolves the AMI for a published region + matching arch", () => {
      const r = resolveGoldenAmi({ manifest, region: "us-east-1", arch: "x86_64" });
      expect(r).toMatchObject({ amiId: "ami-0east", owner: "123456789012" });
    });
    it("returns null when the region is not published", () => {
      expect(resolveGoldenAmi({ manifest, region: "eu-west-1", arch: "x86_64" })).toBeNull();
    });
    it("returns null on arch mismatch", () => {
      expect(resolveGoldenAmi({ manifest, region: "us-east-1", arch: "arm64" })).toBeNull();
    });
    it("returns null with no manifest", () => {
      expect(resolveGoldenAmi({ manifest: null, region: "us-east-1", arch: "x86_64" })).toBeNull();
    });
  });

  describe("fetchGoldenAmiManifest", () => {
    it("falls back to the bundled manifest when the hosted one is unreachable", async () => {
      // Connection refused fast on an unused loopback port → bundled fallback.
      const { manifest, source } = await fetchGoldenAmiManifest({
        url: "https://127.0.0.1:1/none.json",
        timeoutMs: 1000,
      });
      expect(source).toBe("bundled");
      expect(manifest).not.toBeNull();
      // Bundled ships the last known-good AMI as the offline fallback.
      expect(manifest.owner).toBe("493255580566");
      expect(manifest.images["us-east-1"]).toBe("ami-0d7282b5efaa3b1dc");
    });
  });
});
