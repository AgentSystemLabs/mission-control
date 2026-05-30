import { describe, it, expect } from "vitest";
import {
  renderComposeFile,
  renderSandboxCompose,
  sandboxResources,
  DEFAULT_IMAGE_TAG,
  type SandboxComposeSpec,
} from "../sandbox-compose";
import type { SandboxSettings } from "../sandbox-settings";

function spec(overrides: Partial<SandboxComposeSpec> = {}): SandboxComposeSpec {
  return {
    id: "sb-abc-123",
    imageTag: null,
    dockerfilePath: null,
    buildArgs: {},
    env: {},
    hostAgentPort: 19333,
    portMap: {},
    pairingToken: "tok",
    ...overrides,
  };
}

function settings(overrides: Partial<SandboxSettings> = {}): SandboxSettings {
  return {
    enabled: true,
    runtimeMode: "docker",
    dockerfilePath: null,
    buildArgs: {},
    imageTag: null,
    publishedPorts: [],
    workspaceVolume: "mc-workspace",
    projectPaths: {},
    agentPort: 9333,
    pairingToken: "ignored-here",
    agentConfigVolume: "mc-agent-config",
    gitAuthMode: "none",
    ...overrides,
  };
}

describe("renderComposeFile", () => {
  it("ALWAYS injects MC_PAIRING_TOKEN (Phase 1 carry-forward — agent fails closed without it)", () => {
    const yaml = renderComposeFile(settings(), "tok-abc-123");
    expect(yaml).toContain("MC_PAIRING_TOKEN: 'tok-abc-123'");
  });

  it("uses the default image when no Dockerfile path is set", () => {
    const yaml = renderComposeFile(settings({ imageTag: null }), "t");
    expect(yaml).toContain(`image: '${DEFAULT_IMAGE_TAG}'`);
    expect(yaml).not.toContain("build:");
  });

  it("uses a custom image tag when set", () => {
    const yaml = renderComposeFile(settings({ imageTag: "acme/sbx:1" }), "t");
    expect(yaml).toContain("image: 'acme/sbx:1'");
  });

  it("emits a build block + args for a BYO Dockerfile directory", () => {
    const yaml = renderComposeFile(
      settings({ dockerfilePath: "/nonexistent/builddir", buildArgs: { NODE: "22" } }),
      "t",
    );
    expect(yaml).toContain("build:");
    // path doesn't exist → treated as a Dockerfile file, so context is its dirname
    expect(yaml).toContain("context: '/nonexistent'");
    expect(yaml).toContain("dockerfile: 'builddir'");
    expect(yaml).toContain("args:");
    expect(yaml).toContain("NODE: '22'");
  });

  it("maps the agent port and published ports on loopback, skipping a duplicate agent port", () => {
    const yaml = renderComposeFile(settings({ agentPort: 9333, publishedPorts: [3000, 9333, 5173] }), "t");
    // Every mapping is bound to 127.0.0.1 — never 0.0.0.0 (which would be LAN-reachable).
    expect(yaml).toContain("- '127.0.0.1:9333:9333'");
    expect(yaml).toContain("- '127.0.0.1:3000:3000'");
    expect(yaml).toContain("- '127.0.0.1:5173:5173'");
    expect(yaml).not.toMatch(/- "\d+:\d+"/); // no bare host:container (0.0.0.0) mappings
    // 9333 should appear once (the agent mapping), not duplicated as a published port
    expect(yaml.match(/- '127\.0\.0\.1:9333:9333'/g)).toHaveLength(1);
  });

  it("does not render an injected build-arg key (compose-injection guard)", () => {
    const yaml = renderComposeFile(
      settings({
        dockerfilePath: "/x/Dockerfile",
        buildArgs: { "EVIL\n      privileged: true\n      x": "y", OK: "1" },
      }),
      "t",
    );
    expect(yaml).not.toContain("privileged: true");
    expect(yaml).toContain("OK: '1'");
  });

  it("single-quotes user values so Compose does not interpolate host env vars", () => {
    const yaml = renderSandboxCompose(
      spec({
        dockerfilePath: "/build",
        buildArgs: { TOKEN: "${HOST_SECRET}" },
        env: { API_KEY: "${HOST_API_KEY}" },
      }),
    );

    expect(yaml).toContain("TOKEN: '${HOST_SECRET}'");
    expect(yaml).toContain("API_KEY: '${HOST_API_KEY}'");
  });

  it("falls back to a safe volume name if an injected one slips through", () => {
    const yaml = renderComposeFile(
      settings({ workspaceVolume: "../../etc:/host # " }),
      "t",
    );
    expect(yaml).not.toContain("/host");
    expect(yaml).toContain("- mc-workspace:/workspace");
  });

  it("declares the named volumes and host-gateway", () => {
    const yaml = renderComposeFile(settings({ workspaceVolume: "wsvol", agentConfigVolume: "cfgvol" }), "t");
    expect(yaml).toContain("- wsvol:/workspace");
    expect(yaml).toContain("- cfgvol:/home/workspace/.config");
    expect(yaml).toContain('"host.docker.internal:host-gateway"');
    expect(yaml).toMatch(/volumes:\n {2}wsvol:\n {2}cfgvol:/);
  });

  it("persists agent-CLI auth dirs (claude/codex/cursor/opencode) on dedicated volumes", () => {
    const yaml = renderComposeFile(settings({}), "t");
    // Mounted into $HOME (not .config) so logins survive a container recreate.
    expect(yaml).toContain("- mc-agent-claude:/home/workspace/.claude");
    expect(yaml).toContain("- mc-agent-codex:/home/workspace/.codex");
    expect(yaml).toContain("- mc-agent-cursor:/home/workspace/.cursor");
    // OpenCode auth lives in the XDG data dir, not .config — mount that subdir only.
    expect(yaml).toContain("- mc-agent-opencode:/home/workspace/.local/share/opencode");
    // ...and declared as top-level named volumes.
    expect(yaml).toMatch(
      /\n {2}mc-agent-claude:\n {2}mc-agent-codex:\n {2}mc-agent-cursor:\n {2}mc-agent-opencode:\n/,
    );
  });

  it("points CLAUDE_CONFIG_DIR at the persisted .claude volume (so .claude.json persists)", () => {
    const yaml = renderComposeFile(settings({}), "t");
    expect(yaml).toContain("CLAUDE_CONFIG_DIR: /home/workspace/.claude");
  });
});

describe("sandboxResources", () => {
  it("namespaces every resource by sandbox id", () => {
    const r = sandboxResources("sb-abc-123");
    expect(r.project).toBe("mc-sb-sb-abc-123");
    expect(r.container).toBe("mc-sandbox-sb-abc-123");
    expect(r.network).toBe("mc-net-sb-abc-123");
    expect(r.volumes.workspace).toBe("mc-sb-sb-abc-123-workspace");
    expect(r.volumes.claude).toBe("mc-sb-sb-abc-123-claude");
    // No two sandboxes share a volume name.
    const other = sandboxResources("sb-xyz-999");
    expect(new Set([...Object.values(r.volumes), ...Object.values(other.volumes)]).size).toBe(14);
  });

  it("rejects an unsafe id (defense against compose identifier injection)", () => {
    expect(sandboxResources("bad name # ").container).toBe("mc-sandbox-invalid");
  });
});

describe("renderSandboxCompose", () => {
  it("namespaces container/volumes/network and injects the pairing token", () => {
    const yaml = renderSandboxCompose(spec({ id: "sb-flex-1", pairingToken: "tok-9" }));
    expect(yaml).toContain("container_name: mc-sandbox-sb-flex-1");
    expect(yaml).toContain("networks: [mc-net-sb-flex-1]");
    expect(yaml).toContain("- mc-sb-sb-flex-1-workspace:/workspace");
    expect(yaml).toContain("- mc-sb-sb-flex-1-opencode:/home/workspace/.local/share/opencode");
    expect(yaml).toContain("MC_PAIRING_TOKEN: 'tok-9'");
    expect(yaml).toContain("CLAUDE_CONFIG_DIR: /home/workspace/.claude");
    expect(yaml).toMatch(/networks:\n {2}mc-net-sb-flex-1:\n {4}driver: bridge/);
  });

  it("binds the agent port and each declared port to its auto-assigned host port (loopback only)", () => {
    const yaml = renderSandboxCompose(spec({ hostAgentPort: 19333, portMap: { 3000: 3000, 5173: 15173 } }));
    expect(yaml).toContain("- '127.0.0.1:19333:9333'");
    expect(yaml).toContain("- '127.0.0.1:3000:3000'");
    expect(yaml).toContain("- '127.0.0.1:15173:5173'"); // remapped to avoid a host clash
    expect(yaml).not.toMatch(/- "\d+:\d+"/); // never a bare 0.0.0.0 mapping
  });

  it("never publishes a declared port over the agent port", () => {
    const yaml = renderSandboxCompose(spec({ hostAgentPort: 19333, portMap: { 9333: 40000 } }));
    expect(yaml).toContain("- '127.0.0.1:19333:9333'");
    expect(yaml).not.toContain("- '127.0.0.1:40000:9333'");
  });

  it("injects validated per-sandbox env and rejects injection-shaped keys", () => {
    const yaml = renderSandboxCompose(spec({ env: { API_KEY: "secret", "bad key": "x" } }));
    expect(yaml).toContain("API_KEY: 'secret'");
    expect(yaml).not.toContain("bad key");
  });

  it("uses a BYO Dockerfile build block when set, else the default image", () => {
    expect(renderSandboxCompose(spec({ imageTag: null }))).toContain(`image: '${DEFAULT_IMAGE_TAG}'`);
    const byo = renderSandboxCompose(spec({ dockerfilePath: "/build", buildArgs: { NODE: "22" } }));
    expect(byo).toContain("build:");
    expect(byo).toContain("NODE: '22'");
    expect(byo).not.toContain("image:");
  });
});
